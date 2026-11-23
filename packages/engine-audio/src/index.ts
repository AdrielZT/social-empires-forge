export type MusicTrackId =
  | "village"
  | "battle"
  | "assault"
  | "quest"
  | "ship"
  | "survival"
  | "trollcamp";

export const MUSIC_TRACK_FILES: Record<MusicTrackId, string> = {
  village: "Spirit of Eternity.mp3",
  battle: "BATALLA.mp3",
  assault: "ASSAULTS.mp3",
  quest: "QUESTS.mp3",
  ship: "BARCO.mp3",
  survival: "SURVIVAL.mp3",
  trollcamp: "trollcamp_v2.mp3"
};
