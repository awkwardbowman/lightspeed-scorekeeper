import { createClient } from "https://esm.sh/@supabase/supabase-js@2.119.0";
import { validateProcessed } from "../_shared/image.ts";
import WebPDecoder from "./vendor/webp_dec.js";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
// Vendored pinned jSquash/libwebp decoder, Apache-2.0. Bundle the WASM as a static
// file; validation needs no external processing service or network fetch.
let decoder:
  | Promise<{ decode(bytes: ArrayBuffer): { width: number; height: number } }>
  | undefined;
async function decode(bytes: Uint8Array) {
  if (!decoder) {
    if (!("ImageData" in globalThis))
      Object.assign(globalThis, {
        ImageData: class {
          constructor(
            public data: Uint8ClampedArray,
            public width: number,
            public height: number,
          ) {}
        },
      });
    decoder = Deno.readFile(new URL("./vendor/webp_dec.wasm", import.meta.url))
      .then((wasmBinary) => WebPDecoder({ wasmBinary }))
      .catch((e) => {
        decoder = undefined;
        throw e;
      });
  }
  const image = (await decoder).decode(bytes.buffer as ArrayBuffer);
  if (!image) throw new Error("Image decoding failed. Choose another image.");
  return image;
}
Deno.serve(async (req: Request) => {
  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  if (req.method === "OPTIONS") return reply({});
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: {
        headers: { Authorization: req.headers.get("Authorization") ?? "" },
      },
      auth: { persistSession: false },
    });
    const { data: identity, error: authError } = await caller.auth.getUser();
    if (authError || !identity.user)
      return reply({ error: "Sign in required" }, 401);
    const { data: profile, error: profileError } =
      await caller.rpc("account_status");
    if (
      profileError ||
      !profile?.is_active ||
      profile.is_deleted ||
      profile.must_change_password
    )
      return reply({ error: "Active Management account required" }, 403);
    // account_status enforces revoked-session denial; core permission is checked
    // once more at DB registration to handle disabling during image processing.
    if (Number(req.headers.get("Content-Length") ?? 0) > 310000)
      return reply({ error: "Processed upload is too large" }, 413);
    let length = 0;
    const chunks: Uint8Array[] = [];
    const reader = req.body?.getReader();
    if (!reader) throw new Error("Image is required");
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 310000) {
        await reader.cancel();
        return reply({ error: "Processed upload is too large" }, 413);
      }
      chunks.push(value);
    }
    const raw = new Uint8Array(length);
    let offset = 0;
    for (const c of chunks) {
      raw.set(c, offset);
      offset += c.length;
    }
    const uploadUrl = new URL(req.url),
      id = uploadUrl.searchParams.get("id") ?? "",
      name = (uploadUrl.searchParams.get("name") ?? "").trim();
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        id,
      ) ||
      !name ||
      name.length > 160
    )
      throw new Error("Valid upload ID and image name required");
    if (req.headers.get("Content-Type")?.split(";")[0] !== "image/webp")
      throw new Error("Processed WebP required");
    const info = validateProcessed(raw),
      decoded = await decode(raw);
    if (decoded.width !== info.width || decoded.height !== info.height)
      throw new Error("Invalid image dimensions");
    const hash = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", raw)),
    )
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const service = createClient(
      url,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const check = (error: { message: string } | null) => {
      if (error) throw new Error(error.message);
    };
    check(
      (
        await service.rpc("reserve_image_upload", {
          p_id: id,
          p_hash: hash,
          p_actor: identity.user.id,
        })
      ).error,
    );
    const path = `${id}.webp`,
      bucket = service.storage.from("image-library");
    const uploaded = await bucket.upload(path, raw, {
      contentType: "image/webp",
      upsert: false,
    });
    if (uploaded.error) {
      // A response may be lost after upload. Resume only if stored bytes match;
      // never overwrite an immutable asset or delete another attempt's object.
      const existing = await bucket.download(path);
      if (existing.error) throw uploaded.error;
      const oldHash = Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            await existing.data.arrayBuffer(),
          ),
        ),
      )
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      if (oldHash !== hash)
        throw new Error("Upload ID already contains a different image");
    }
    const rechecked = await caller.rpc("account_status");
    if (
      rechecked.error ||
      !rechecked.data?.is_active ||
      rechecked.data.is_deleted ||
      rechecked.data.must_change_password
    )
      return reply(
        {
          error: "Account disabled or session revoked; upload remains pending",
        },
        403,
      );
    const registered = await service.rpc("register_image_asset", {
      p_id: id,
      p_name: name,
      p_width: info.width,
      p_height: info.height,
      p_size: raw.length,
      p_hash: hash,
      p_actor: identity.user.id,
    });
    check(registered.error);
    return reply({ asset: registered.data });
  } catch (e) {
    return reply(
      {
        error:
          e instanceof Error
            ? e.message
            : "Image upload failed; retry with the same image",
      },
      400,
    );
  }
});
