// Header inspection bounds allocation BEFORE either browser or trusted decoding.
export function inspectRaster(bytes: Uint8Array): {
  mime: string;
  width: number;
  height: number;
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (start: number, end: number) =>
    String.fromCharCode(...bytes.slice(start, end));
  const fail = (): never => {
    throw new Error("Choose a valid PNG, JPEG or static WebP image.");
  };
  if (bytes.length < 24) return fail();
  if (text(0, 4) === "RIFF" && text(8, 12) === "WEBP") {
    if (view.getUint32(4, true) + 8 !== bytes.length) return fail();
    let width = 0,
      height = 0,
      imageCount = 0,
      canvasWidth = 0,
      canvasHeight = 0;
    for (let pos = 12; pos < bytes.length; ) {
      if (pos + 8 > bytes.length) return fail();
      const kind = text(pos, pos + 4),
        size = view.getUint32(pos + 4, true),
        data = pos + 8;
      if (data + size > bytes.length) return fail();
      if (kind === "VP8X") {
        if (size !== 10 || bytes[data] & 0x02) return fail(); // animated image
        canvasWidth =
          1 +
          bytes[data + 4] +
          (bytes[data + 5] << 8) +
          (bytes[data + 6] << 16);
        canvasHeight =
          1 +
          bytes[data + 7] +
          (bytes[data + 8] << 8) +
          (bytes[data + 9] << 16);
      } else if (kind === "VP8 ") {
        if (
          size < 10 ||
          bytes[data] & 1 ||
          text(data + 3, data + 6) !== "\x9d\x01\x2a"
        )
          return fail();
        width = view.getUint16(data + 6, true) & 0x3fff;
        height = view.getUint16(data + 8, true) & 0x3fff;
        imageCount++;
      } else if (kind === "VP8L") {
        if (size < 5 || bytes[data] !== 0x2f) return fail();
        const bits = view.getUint32(data + 1, true);
        if (bits >>> 29) return fail();
        width = (bits & 0x3fff) + 1;
        height = ((bits >>> 14) & 0x3fff) + 1;
        imageCount++;
      } else if (!["ALPH", "ICCP", "EXIF", "XMP "].includes(kind))
        return fail();
      pos = data + size + (size & 1);
      if (pos > bytes.length) return fail();
    }
    if (
      imageCount !== 1 ||
      !width ||
      !height ||
      (canvasWidth && (canvasWidth !== width || canvasHeight !== height))
    )
      return fail();
    return { mime: "image/webp", width, height };
  }
  if (
    text(0, 8) === "\x89PNG\r\n\x1a\n" &&
    text(12, 16) === "IHDR" &&
    view.getUint32(8) === 13
  ) {
    return {
      mime: "image/png",
      width: view.getUint32(16),
      height: view.getUint32(20),
    };
  }
  if (bytes[0] === 255 && bytes[1] === 216) {
    for (let pos = 2; pos + 4 <= bytes.length; ) {
      if (bytes[pos++] !== 255) return fail();
      while (bytes[pos] === 255) pos++;
      const marker = bytes[pos++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (pos + 2 > bytes.length) return fail();
      const size = view.getUint16(pos);
      if (size < 2 || pos + size > bytes.length) return fail();
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker)
      ) {
        if (size < 8) return fail();
        return {
          mime: "image/jpeg",
          width: view.getUint16(pos + 5),
          height: view.getUint16(pos + 3),
        };
      }
      pos += size;
    }
  }
  return fail();
}
export function validateProcessed(bytes: Uint8Array) {
  if (bytes.length > 307200)
    throw new Error("Processed image must be at most 300 KB.");
  const info = inspectRaster(bytes);
  if (
    info.mime !== "image/webp" ||
    info.width < 1 ||
    info.height < 1 ||
    info.width > 512 ||
    info.height > 512
  )
    throw new Error("Upload an optimized WebP image within 512 × 512 pixels.");
  return info;
}
