import {
  inspectRaster,
  validateProcessed,
} from "../supabase/functions/_shared/image";
export interface ProcessedImage {
  blob: Blob;
  width: number;
  height: number;
}
export async function processImage(
  file: File,
  bound = 512,
  quality = 0.82,
): Promise<ProcessedImage> {
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    file.size > 10 * 1024 * 1024
  )
    throw new Error("Choose a PNG, JPEG or WebP up to 10 MB.");
  const info = inspectRaster(new Uint8Array(await file.arrayBuffer()));
  if (
    info.mime !== file.type ||
    !info.width ||
    !info.height ||
    info.width > 16000 ||
    info.height > 16000 ||
    info.width * info.height > 24000000
  )
    throw new Error(
      "Choose an image up to 24 megapixels and 16,000 pixels per side.",
    );
  if (typeof createImageBitmap !== "function")
    throw new Error(
      "Image conversion is unavailable in this browser. Try a current browser or another image.",
    );
  const bitmap = await createImageBitmap(file);
  try {
    const ratio = Math.min(1, bound / bitmap.width, bound / bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image conversion unavailable.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) =>
          b
            ? resolve(b)
            : reject(new Error("Image conversion failed. Try another image.")),
        "image/webp",
        quality,
      ),
    );
    if (blob.type !== "image/webp")
      throw new Error(
        "This browser cannot create WebP images. Try another browser.",
      );
    validateProcessed(new Uint8Array(await blob.arrayBuffer()));
    return { blob, width: canvas.width, height: canvas.height };
  } finally {
    bitmap.close();
  }
}
