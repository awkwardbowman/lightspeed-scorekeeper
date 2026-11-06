# Vendored WebP decoder

`webp_dec.js` and `webp_dec.wasm` are the decoder from npm `@jsquash/webp@1.5.0`, copied unchanged from `codec/dec/` of its published tarball. The wrapper/codec license is Apache-2.0 (`LICENSE`); libwebp's BSD license is retained as `LIBWEBP_LICENSE`.

This decoder verifies the bounded, optimized input inside the trusted image endpoint. It is not a server-side resize service. The WASM file is declared in `supabase/config.toml` static_files and must be included during deployment. Update JS/WASM together and rerun malformed-image and browser upload tests when upgrading.
c57971611f4d9ec04e4636ce7bb4a35c031b24cbdb013518f0a017d9f6014370  supabase/functions/image-assets/vendor/webp_dec.js
30fb52fa2a80166d25ba7debf902218904ba1f05ccce9f959f722beff9e2f344  supabase/functions/image-assets/vendor/webp_dec.wasm
