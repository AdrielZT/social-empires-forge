const rawBase = import.meta.env.BASE_URL || "/";

export const BASE_URL = rawBase.endsWith("/") ? rawBase : `${rawBase}/`;
export const IS_STATIC_MODE = import.meta.env.VITE_STATIC_MODE === "true";

// Exact set of thumbnails compiled as .png in assets/generated/ui/thumbs/ (all others are .jpg)
const PNG_THUMB_STEMS = new Set<string>([
  "822_dragon_rider1_training",
  "823_dragon_rider2_training",
  "824_dragon_rider3_training",
  "arqueroelfo_altar",
  "mago_altar",
  "princearthur_altar",
  "ranger_altar",
  "thor_altar",
  "valkiria_altar",
  "wallace_altar",
  "xena_altar"
]);

export function assetsBaseUrl(): string {
  return `${BASE_URL}assets`;
}

export function audioBaseUrl(): string {
  return `${BASE_URL}assets/audio`;
}

export function dataUrl(relPath: string): string {
  return `${BASE_URL}game-data/${relPath.replace(/^\/+/, "")}`;
}

export function thumbUrl(imgName: string): string {
  const ext = PNG_THUMB_STEMS.has(imgName) ? "png" : "jpg";
  return `${BASE_URL}assets/ui/thumbs/${encodeURIComponent(imgName)}.${ext}`;
}
