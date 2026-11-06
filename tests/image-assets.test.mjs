import { readFile } from "node:fs/promises";
import { transform } from "esbuild";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import WebPDecoder from "../supabase/functions/image-assets/vendor/webp_dec.js";
const shared = await transform(
  await readFile(
    new URL("../supabase/functions/_shared/image.ts", import.meta.url),
    "utf8",
  ),
  { loader: "ts", format: "esm" },
);
const { validateProcessed } = await import(
  `data:text/javascript;base64,${Buffer.from(shared.code).toString("base64")}`
);
const source = (
  await readFile(
    new URL("../supabase/functions/image-assets/index.ts", import.meta.url),
    "utf8",
  )
)
  .replace(
    /import \{ createClient \} from ["'][^"']+["'];/,
    "const createClient=deps.createClient;",
  )
  .replace(
    /import \{ validateProcessed \} from ["'][^"']+["'];/,
    "const validateProcessed=deps.validateProcessed;",
  )
  .replace(
    /import WebPDecoder from ["'][^"']+["'];/,
    "const WebPDecoder=deps.WebPDecoder;",
  )
  .replaceAll("import.meta.url", "deps.moduleUrl");
const { code } = await transform(source, { loader: "ts", format: "esm" });
const bytes = new Uint8Array(
  await readFile(new URL("./fixtures/logo.webp", import.meta.url)),
);
assert.deepEqual(validateProcessed(bytes), {
  mime: "image/webp",
  width: 64,
  height: 32,
});
const objects = new Map(),
  reservations = new Map(),
  assets = new Map(),
  events = [];
let handler,
  active = true,
  signedIn = true,
  revoked = false,
  mustChangePassword = false,
  registrationFailure = false;
const caller = {
  auth: {
    getUser: async () => ({
      data: { user: signedIn ? { id: "actor" } : null },
      error: null,
    }),
  },
  rpc: async () => ({
    data: revoked
      ? null
      : {
          is_active: active,
          is_deleted: false,
          must_change_password: mustChangePassword,
        },
    error: null,
  }),
};
const service = {
  rpc: async (name, args) => {
    events.push(name);
    if (name === "reserve_image_upload") {
      const old = reservations.get(args.p_id);
      if (old && old !== args.p_hash)
        return { error: { message: "Upload ID already used" } };
      reservations.set(args.p_id, args.p_hash);
      return { error: null };
    }
    if (registrationFailure)
      return { error: { message: "Database unavailable. Retry." } };
    const asset = assets.get(args.p_id) ?? {
      id: args.p_id,
      width: args.p_width,
      height: args.p_height,
      byte_size: args.p_size,
      content_hash: args.p_hash,
    };
    assets.set(args.p_id, asset);
    return { data: asset, error: null };
  },
  storage: {
    from: (bucket) => {
      assert.equal(bucket, "image-library");
      return {
        upload: async (path, binary, options) => {
          events.push("upload");
          assert.equal(options.upsert, false);
          assert.equal(options.contentType, "image/webp");
          if (objects.has(path))
            return { error: { message: "Already exists" } };
          objects.set(path, new Uint8Array(binary));
          return { error: null };
        },
        download: async (path) =>
          objects.has(path)
            ? { data: new Blob([objects.get(path)]), error: null }
            : { error: { message: "Not found" } },
      };
    },
  },
};
let clients = 0;
new Function("Deno", "deps", code)(
  {
    env: {
      get: (name) =>
        name === "SUPABASE_URL" ? "https://test.invalid" : "runtime-fixture",
    },
    serve: (fn) => (handler = fn),
    readFile: async () =>
      new Uint8Array(
        await readFile(
          new URL(
            "../supabase/functions/image-assets/vendor/webp_dec.wasm",
            import.meta.url,
          ),
        ),
      ),
  },
  {
    createClient: () => (clients++ % 2 === 0 ? caller : service),
    validateProcessed,
    WebPDecoder,
    moduleUrl: new URL(
      "../supabase/functions/image-assets/index.ts",
      import.meta.url,
    ).href,
  },
);
async function request(
  binary = bytes,
  {
    id = randomUUID(),
    type = "image/webp",
    name = "Logo",
    method = "POST",
  } = {},
) {
  clients = 0;
  const response = await handler(
    new Request(
      `https://test.invalid/image-assets?id=${id}&name=${encodeURIComponent(name)}`,
      {
        method,
        headers: { Authorization: "Bearer fixture", "Content-Type": type },
        body: method === "POST" ? binary : undefined,
      },
    ),
  );
  return { status: response.status, body: await response.json() };
}
assert.equal((await request(bytes, { method: "OPTIONS" })).status, 200);
signedIn = false;
assert.equal((await request()).status, 401);
signedIn = true;
active = false;
assert.equal((await request()).status, 403);
active = true;
revoked = true;
assert.equal((await request()).status, 403);
revoked = false;
mustChangePassword = true;
assert.equal((await request()).status, 403);
mustChangePassword = false;
assert.equal(events.length, 0, "blocked accounts cannot reserve or upload");
assert.equal((await request(bytes, { type: "image/png" })).status, 400);
assert.equal((await request(bytes, { id: "bad" })).status, 400);
assert.equal((await request(new Uint8Array(310001))).status, 413);
assert.equal(
  (await request(new TextEncoder().encode('<svg onload="alert(1)"></svg>')))
    .status,
  400,
);
let vp8 = 12;
while (String.fromCharCode(...bytes.slice(vp8, vp8 + 4)) !== "VP8 ") {
  const length = new DataView(bytes.buffer, bytes.byteOffset).getUint32(
    vp8 + 4,
    true,
  );
  vp8 += 8 + length + (length & 1);
}
const corrupt = bytes.slice(0, vp8 + 18);
const corruptView = new DataView(corrupt.buffer);
corruptView.setUint32(4, corrupt.length - 8, true);
corruptView.setUint32(vp8 + 4, 10, true);
assert.equal(
  (await request(corrupt)).status,
  400,
  "real libwebp decoding rejects corrupted compressed pixels",
);
assert.equal(events.length, 0, "invalid files never reach Storage");
const id = randomUUID();
const first = await request(bytes, { id });
assert.equal(first.status, 200, JSON.stringify(first));
assert.equal(first.body.asset.width, 64);
assert.deepEqual(events.slice(-3), [
  "reserve_image_upload",
  "upload",
  "register_image_asset",
]);
assert.equal(objects.size, 1);
assert.deepEqual(
  await request(bytes, { id }),
  first,
  "lost final response retries immutable asset",
);
assert.equal(objects.size, 1);
registrationFailure = true;
const pendingId = randomUUID();
const failed = await request(bytes, { id: pendingId });
assert.equal(failed.status, 400);
assert.ok(
  reservations.has(pendingId),
  "partial upload remains tracked and recoverable",
);
assert.ok(objects.has(`${pendingId}.webp`));
assert.ok(!assets.has(pendingId));
registrationFailure = false;
assert.equal((await request(bytes, { id: pendingId })).status, 200);
assert.ok(assets.has(pendingId));
console.log(
  "PASS: real WebP decoder, bounded/truncated input, type/spoof/corruption rejection, verified account gates, immutable uploads, processed-byte payloads, lost-response retry and tracked partial-upload recovery.",
);
