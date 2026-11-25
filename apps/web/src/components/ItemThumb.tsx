import { useEffect, useState } from "react";
import type { SpriteAtlasMetadata } from "@sef/shared-types";
import { assetsBaseUrl, resolveThumbKind, spriteAtlasUrl, thumbUrl } from "../api/paths.js";

// In-memory cache of frame-0 thumbnails cropped from WebP sprite atlases
const spriteThumbCache = new Map<string, string | null>();
const spriteThumbInflight = new Map<string, Promise<string | null>>();

async function extractSpriteThumb(imgName: string): Promise<string | null> {
  if (spriteThumbCache.has(imgName)) return spriteThumbCache.get(imgName) ?? null;
  const pending = spriteThumbInflight.get(imgName);
  if (pending) return pending;

  const promise = (async (): Promise<string | null> => {
    try {
      const metaRes = await fetch(spriteAtlasUrl(imgName));
      if (!metaRes.ok) {
        spriteThumbCache.set(imgName, null);
        return null;
      }
      const meta = (await metaRes.json()) as SpriteAtlasMetadata;
      const anim = meta.animations["f1"] ?? Object.values(meta.animations)[0];
      const frameKey = anim?.frames[0] ?? Object.keys(meta.frames)[0];
      const rect = frameKey ? meta.frames[frameKey] : undefined;
      if (!rect || rect.w <= 0 || rect.h <= 0) {
        spriteThumbCache.set(imgName, null);
        return null;
      }

      const imgRes = await fetch(`${assetsBaseUrl()}/${meta.atlasImage}`);
      if (!imgRes.ok) {
        spriteThumbCache.set(imgName, null);
        return null;
      }
      const blob = await imgRes.blob();
      const bitmap = await createImageBitmap(blob);

      const maxDim = 96;
      const scale = Math.min(1, maxDim / Math.max(rect.w, rect.h));
      const dw = Math.max(1, Math.round(rect.w * scale));
      const dh = Math.max(1, Math.round(rect.h * scale));
      const canvas = document.createElement("canvas");
      canvas.width = dw;
      canvas.height = dh;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        bitmap.close();
        spriteThumbCache.set(imgName, null);
        return null;
      }
      ctx.drawImage(bitmap, rect.x, rect.y, rect.w, rect.h, 0, 0, dw, dh);
      bitmap.close();
      const url = canvas.toDataURL("image/png");
      spriteThumbCache.set(imgName, url);
      return url;
    } catch {
      spriteThumbCache.set(imgName, null);
      return null;
    }
  })();

  spriteThumbInflight.set(imgName, promise);
  try {
    return await promise;
  } finally {
    spriteThumbInflight.delete(imgName);
  }
}

/**
 * Zero-404 item thumbnail renderer for Social Empires 1.4.07:
 * 1. Dedicated `ui/thumbs/<imgName>.jpg|png` when present.
 * 2. Cached frame-0 crop extracted client-side from `sprites/<imgName>.webp` when no thumb exists.
 * 3. Crisp heraldic SVG emblem if the upstream SWF asset was absent in 1.4.07.
 */
export function ItemThumb(props: {
  imgName: string;
  alt: string;
  itemType?: "b" | "u";
  className?: string;
}) {
  const kind = resolveThumbKind(props.imgName);
  const [src, setSrc] = useState<string | null>(() => {
    if (kind === "thumb") return thumbUrl(props.imgName);
    if (kind === "sprite") return spriteThumbCache.get(props.imgName) ?? null;
    return null;
  });
  const [failed, setFailed] = useState<boolean>(kind === "fallback");

  useEffect(() => {
    let cancelled = false;
    const nextKind = resolveThumbKind(props.imgName);
    if (nextKind === "thumb") {
      setSrc(thumbUrl(props.imgName));
      setFailed(false);
      return;
    }
    if (nextKind === "fallback") {
      setSrc(null);
      setFailed(true);
      return;
    }
    const cached = spriteThumbCache.get(props.imgName);
    if (cached !== undefined) {
      setSrc(cached);
      setFailed(cached === null);
      return;
    }
    setFailed(false);
    void extractSpriteThumb(props.imgName).then((dataUrl) => {
      if (cancelled) return;
      if (dataUrl) {
        setSrc(dataUrl);
        setFailed(false);
      } else {
        setSrc(null);
        setFailed(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [props.imgName]);

  if (failed || !src) {
    return (
      <div
        className={`flex items-center justify-center bg-gradient-to-b from-[#3d2514] to-[#1e1209] text-amber-300/80 ${props.className ?? "h-full w-full"}`}
        title={props.alt}
      >
        <svg viewBox="0 0 36 36" className="h-3/4 w-3/4" aria-hidden="true">
          <path
            d="M18 4l11 4.5v8.2c0 6.8-4.6 12.2-11 14.8-6.4-2.6-11-8-11-14.8V8.5L18 4z"
            fill="#5c3618"
            stroke="#e5b14c"
            strokeWidth="2"
          />
          {props.itemType === "u" ? (
            <path d="M12 24l12-12M19 11h6v6M12 12l12 12" stroke="#fde047" strokeWidth="2.2" strokeLinecap="round" />
          ) : (
            <path d="M11 23v-8l7-5 7 5v8h-5v-5h-4v5z" fill="#e5b14c" />
          )}
        </svg>
      </div>
    );
  }

  return (
    <img
      src={src}
      loading="lazy"
      alt={props.alt}
      onError={() => {
        if (kind === "thumb") {
          void extractSpriteThumb(props.imgName).then((dataUrl) => {
            if (dataUrl) setSrc(dataUrl);
            else setFailed(true);
          });
        } else {
          setFailed(true);
        }
      }}
      className={props.className ?? "h-full w-full object-contain"}
    />
  );
}
