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

export const SFX_NAMES = {
  buttonClick: "ButtonClickSound",
  rollOver: "RollOverSound",
  build: "BuildSound",
  finalBuild: "FinalConstruc1Sound",
  buildingMenu: "BuildingMenuSound",
  collect: "Collection2Sound",
  levelUp: "LevelUpSound",
  achievement: "AchievementSound",
  newTown: "NewTownSound",
  sword1: "Sword2Sound",
  sword2: "Sword5Sound",
  archer: "Archer3Sound",
  crossbow: "BallestaSound",
  cannon: "CanonSound",
  fireball: "FireballSound",
  heal: "CurarSound",
  lumber: "Lumber3Sound",
  rock: "Rock6Sound",
  farm: "FarmSound",
  dieMan: "DieManSound",
  dieWoman: "DieWomanSound",
  dieTroll: "MuerteTrol2Sound"
} as const;
