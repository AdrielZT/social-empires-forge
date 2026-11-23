import type { GameItem, GoalDef, MagicSpellDef } from "@sef/shared-types";

export * from "./i18n.js";

export interface CompiledGameDatabase {
  readonly version: string;
  readonly items: readonly GameItem[];
  readonly itemsById: ReadonlyMap<number, GameItem>;
  readonly magics: readonly MagicSpellDef[];
  readonly goals: readonly GoalDef[];
  readonly globals: Readonly<Record<string, unknown>>;
  readonly localizationEn: Readonly<Record<string, string>>;
  readonly localizationEs: Readonly<Record<string, string>>;
}

export function createGameDatabase(raw: {
  version: string;
  items: GameItem[];
  magics: MagicSpellDef[];
  goals: GoalDef[];
  globals: Record<string, unknown>;
  localizationEn: Record<string, string>;
  localizationEs: Record<string, string>;
}): CompiledGameDatabase {
  const itemsById = new Map<number, GameItem>();
  for (const item of raw.items) {
    itemsById.set(item.id, item);
  }
  return {
    ...raw,
    itemsById
  };
}
