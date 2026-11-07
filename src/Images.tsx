import { useEffect, useRef, useState } from "react";
import { db, message, rpc, type ImageAsset, type Profile } from "./data";
import { Intro, Notice, useAction, useRows } from "./ui";
import { processImage, type ProcessedImage } from "./imageProcessing";

export function useHashParams() {
  const read = () =>
    new URLSearchParams(window.location.hash.split("?")[1] ?? "");
  const [params, setParams] = useState(read);
  useEffect(() => {
    const update = () => setParams(read());
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return params;
}
export function ImagePreview({
  asset,
  path,
  url,
  alt = "Team logo",
}: {
  asset?: ImageAsset;
  path?: string | null;
  url?: string | null;
  alt?: string;
}) {
  const bucket = asset?.storage_bucket ?? "team-images",
    object = asset?.storage_object_path ?? path;
  const [src, setSrc] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setSrc("");
    setError("");
    const refresh = async () => {
      if (!object) {
        if (active) setSrc(url ?? "");
        return;
      }
      const { data, error } = await db()
        .storage.from(bucket)
        .createSignedUrl(object, 3600);
      if (active) {
        setSrc(data?.signedUrl ?? "");
        setError(error ? "Image unavailable." : "");
      }
    };
    const safelyRefresh = () =>
      void refresh().catch(() => {
        if (active) {
          setSrc("");
          setError("Image unavailable.");
        }
      });
    safelyRefresh();
    const timer = window.setInterval(safelyRefresh, 45 * 60 * 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [bucket, object, url]);
  return src ? (
    <img
      className="team-logo"
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => {
        setSrc("");
        setError("Image unavailable.");
      }}
    />
  ) : (
    <span className="image-placeholder">{error || "No logo"}</span>
  );
}
function useBlobUrl(blob?: Blob) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!blob) {
      setUrl("");
      return;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}
export function UploadImage({
  onUploaded,
  onCancel,
}: {
  onUploaded: (asset: ImageAsset) => void;
  onCancel: () => void;
}) {
  const [file, setFile] = useState<File>(),
    [name, setName] = useState(""),
    [quality, setQuality] = useState(0.82),
    [bound, setBound] = useState(512);
  const [prepared, setPrepared] = useState<{
      image: ProcessedImage;
      file: File;
      quality: number;
      bound: number;
    }>(),
    [processing, setProcessing] = useState(false),
    [processingError, setProcessingError] = useState(""),
    [uploadId, setUploadId] = useState(() => crypto.randomUUID());
  const a = useAction();
  // Never allow uploading a preview created with a previous file or setting.
  const processed =
    prepared &&
    prepared.file === file &&
    prepared.quality === quality &&
    prepared.bound === bound
      ? prepared.image
      : undefined;
  const preview = useBlobUrl(processed?.blob);
  const sequence = useRef(0);
  useEffect(() => {
    const seq = ++sequence.current;
    setProcessing(Boolean(file));
    setProcessingError("");
    if (!file) {
      setPrepared(undefined);
      return;
    }
    // Group rapid setting changes so only the latest optimization is used.
    const timer = window.setTimeout(() => {
      void processImage(file, bound, quality)
        .then((image) => {
          if (seq !== sequence.current) return;
          setPrepared({ image, file, bound, quality });
          setUploadId(crypto.randomUUID());
        })
        .catch((error) => {
          if (seq === sequence.current) setProcessingError(message(error));
        })
        .finally(() => {
          if (seq === sequence.current) setProcessing(false);
        });
    }, 120);
    return () => {
      ++sequence.current;
      window.clearTimeout(timer);
    };
  }, [file, bound, quality]);
  return (
    <fieldset disabled={a.busy} className="image-upload">
      <legend>Upload new image</legend>
      <p>
        PNG, JPEG or WebP · up to 10 MB / 24 megapixels. Review the optimized
        image before uploading.
      </p>
      <label>
        Image name
        <input
          value={name}
          maxLength={160}
          required
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label>
        Choose image
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) {
              setFile(f);
              setName(f.name.replace(/\.[^.]+$/, ""));
            }
          }}
        />
      </label>
      <div className="button-row">
        <label>
          Maximum size
          <select
            value={bound}
            onChange={(e) => setBound(Number(e.target.value))}
          >
            {[512, 384, 256].map((n) => (
              <option key={n} value={n}>
                {n} px
              </option>
            ))}
          </select>
        </label>
        <label>
          Quality
          <select
            value={quality}
            onChange={(e) => setQuality(Number(e.target.value))}
          >
            {[0.7, 0.82, 0.9].map((n) => (
              <option key={n} value={n}>
                {Math.round(n * 100)}%
              </option>
            ))}
          </select>
        </label>
        <p role="status" className="image-preview-status">
          {processing
            ? "Optimizing image…"
            : processed
              ? "Preview automatically updated."
              : file
                ? "Preview unavailable. Choose another image or setting."
                : "Choose an image to see its optimized preview."}
        </p>
      </div>
      {processed && (
        <>
          <img
            className="processed-preview"
            src={preview}
            alt="Processed image preview"
          />
          <p>
            {processed.width} × {processed.height} px ·{" "}
            {(processed.blob.size / 1024).toFixed(1)} KB · WebP
          </p>
        </>
      )}
      <div className="button-row">
        <button
          type="button"
          className="primary"
          disabled={a.busy || processing || !processed || !name.trim()}
          onClick={() =>
            void a.run(async () => {
              const { data, error } = await db().functions.invoke(
                `image-assets?id=${encodeURIComponent(uploadId)}&name=${encodeURIComponent(name.trim())}`,
                {
                  body: processed!.blob,
                  headers: { "Content-Type": "image/webp" },
                },
              );
              if (error) {
                const detail = await error.context?.json?.().catch(() => null);
                throw new Error(detail?.error ?? error.message);
              }
              if (data?.error || !data?.asset)
                throw new Error(
                  data?.error ?? "Upload did not finish. Retry this image.",
                );
              onUploaded(data.asset);
            })
          }
        >
          {a.busy ? "Working…" : "Approve preview and upload"}
        </button>
        <button type="button" onClick={onCancel}>
          Cancel upload
        </button>
      </div>
      <Notice error={processingError || a.error} success={a.status} />
    </fieldset>
  );
}
export function ImagePicker({
  selected,
  onSelect,
  onCancel,
}: {
  selected: string | null;
  onSelect: (id: string | null) => void;
  onCancel: () => void;
}) {
  const assets = useRows<ImageAsset>("tImageAsset");
  const [upload, setUpload] = useState(false);
  return (
    <section aria-label="Choose team logo" className="card">
      {upload ? (
        <UploadImage
          onUploaded={(asset) => onSelect(asset.id)}
          onCancel={() => setUpload(false)}
        />
      ) : (
        <>
          <h3>Choose team logo</h3>
          <div className="button-row">
            <button type="button" onClick={() => setUpload(true)}>
              Upload new image
            </button>
            <button type="button" onClick={() => onSelect(null)}>
              No logo
            </button>
            <button type="button" onClick={onCancel}>
              Cancel selection
            </button>
          </div>
          <AssetGallery
            assets={assets.data.filter(
              (x) => !x.is_archived || x.id === selected,
            )}
            loading={assets.loading}
            loadError={assets.error}
            onSelect={(x) => onSelect(x.id)}
          />
          <Notice error={assets.error} loading={assets.loading} />
        </>
      )}
    </section>
  );
}
function AssetGallery({
  assets,
  onSelect,
  onArchive,
  loading = false,
  loadError = "",
}: {
  assets: ImageAsset[];
  onSelect?: (asset: ImageAsset) => void;
  onArchive?: (asset: ImageAsset) => void;
  loading?: boolean;
  loadError?: string;
}) {
  const uploaders = useRows<Profile>("tUser");
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("active"),
    [limit, setLimit] = useState(24);
  const filtered = assets
    .filter(
      (x) =>
        (filter === "all" || x.is_archived === (filter === "archived")) &&
        `${x.display_name}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort(
      (a, b) =>
        a.display_name.localeCompare(b.display_name, undefined, {
          sensitivity: "base",
        }) || a.id.localeCompare(b.id),
    );
  return (
    <>
      <div className="form-grid">
        <label>
          Search images
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setLimit(24);
            }}
          />
        </label>
        <label>
          Image status
          <select
            aria-label="Image status"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setLimit(24);
            }}
          >
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="all">All</option>
          </select>
        </label>
      </div>
      <div className="record-result-summary">
        <span role="status">{loading ? "Loading images…" : `Showing ${Math.min(filtered.length, limit)} of ${filtered.length} matching images`}</span>
        {(search || filter !== "active") && (
          <button type="button" className="subtle" onClick={() => { setSearch(""); setFilter("active"); setLimit(24); }}>
            Clear filters
          </button>
        )}
      </div>
      <div className="image-gallery">
        {filtered.slice(0, limit).map((x) => (
          <article className="card" key={x.id}>
            <ImagePreview asset={x} alt={x.display_name} />
            <h4>{x.display_name}</h4>
            <p>
              {x.width} × {x.height} · {(x.byte_size / 1024).toFixed(1)} KB
              <br />
              {x.is_archived ? "Archived · " : ""}
              {new Date(x.created_at).toLocaleString()}
            </p>
            <small>
              Uploaded by{" "}
              {uploaders.data.find((u) => u.id === x.owner_id)?.display_name ||
                "Retained Account"}
            </small>

            <div className="button-row">
              {onSelect && !x.is_archived && (
                <button type="button" onClick={() => onSelect(x)}>
                  Select {x.display_name}
                </button>
              )}
              {onArchive && (
                <button type="button" onClick={() => onArchive(x)}>
                  {x.is_archived ? "Restore" : "Archive"} {x.display_name}
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
      {!loading && !loadError && !filtered.length && (
        <p role="status">
          {assets.length === 0
            ? "No images in this library yet."
            : "No images match your filters."}
        </p>
      )}
      {filtered.length > limit && (
        <button type="button" onClick={() => setLimit((n) => n + 24)}>
          Show more images (${Math.min(24, filtered.length - limit)} more)
        </button>
      )}
    </>
  );
}
export default function ImageLibrary() {
  const p = useHashParams(),
    assets = useRows<ImageAsset>("tImageAsset"),
    a = useAction(assets.reload);
  const mode = p.get("mode") ?? "lookup",
    selected = assets.data.find((x) => x.id === p.get("id"));
  return (
    <div className="image-pages">
      <Intro
        title={
          mode === "upload"
            ? "Upload Image"
            : mode === "archive"
              ? selected?.is_archived
                ? "Confirm Image Restore"
                : "Confirm Image Archive"
              : "Image Library"
        }
      />
      {mode === "upload" ? (
        <UploadImage
          onCancel={() => {
            window.location.hash = "/configuration/team-images";
          }}
          onUploaded={() => {
            void assets.reload();
            window.location.hash = "/configuration/team-images";
          }}
        />
      ) : mode === "archive" && selected ? (
        <section className="card">
          <ImagePreview asset={selected} alt={selected.display_name} />
          <h3>{selected.display_name}</h3>
          <p>
            {selected.is_archived
              ? "Restore this image to the active library so it can be selected for teams again."
              : "Archiving hides this image from new selections. Existing teams and history keep their images, and the stored file is retained."}
          </p>
          <button
            disabled={a.busy}
            onClick={() =>
              void a.run(async () => {
                await rpc("archive_image_asset", {
                  p_id: selected.id,
                  p_archived: !selected.is_archived,
                });
                window.location.hash = "/configuration/team-images";
              })
            }
          >
            Confirm {selected.is_archived ? "restore" : "archive"}
          </button>{" "}
          <a href="#/configuration/team-images">Cancel</a>
        </section>
      ) : mode === "archive" && !selected && !assets.loading ? (
        <section className="card">
          <p role="alert">This image could not be found. It may have been removed or the link may be outdated.</p>
          <a href="#/configuration/team-images">Return to Image Library</a>
        </section>
      ) : (
        <>
          <a className="primary" href="#/configuration/team-images?mode=upload">
            Upload new image
          </a>
          <AssetGallery
            assets={assets.data}
            loading={assets.loading}
            loadError={assets.error}
            onArchive={(x) => {
              window.location.hash = `/configuration/team-images?mode=archive&id=${x.id}`;
            }}
          />
        </>
      )}
      <Notice
        error={assets.error || a.error}
        success={a.status}
        loading={assets.loading}
      />
    </div>
  );
}

/** Only show record identifiers in an explicit ID column or dedicated ID lookup. */
export function CopyId({ id }: { id: string }) {
  const [status, setStatus] = useState("");
  return (
    <span className="copy-id">
      <code title={id}>{id.slice(0, 8)}</code>
      <button
        type="button"
        className="copy-id-button"
        aria-label="Copy ID"
        title="Copy ID"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(id);
            setStatus("ID copied");
          } catch {
            setStatus("Unable to copy ID. Check browser clipboard permission.");
          }
        }}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="8" y="8" width="12" height="12" rx="2" />
          <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
        </svg>
      </button>
      {status && <small role="status">{status}</small>}
    </span>
  );
}
