import fs from "node:fs";
import path from "node:path";
import type { GameItem } from "@sef/shared-types";
import { DECOMPILED_AS3_DIR, GAME_DATA_DIR } from "./paths.js";

interface ExtractedSpecialAttack {
  id: string;
  name: string;
  kind:
    | "area_damage"
    | "whirlwind"
    | "rain"
    | "beam"
    | "energy_balls"
    | "spawn_minion"
    | "heal_aura"
    | "push_in_air"
    | "dizzy"
    | "freeze"
    | "poison"
    | "incinerate"
    | "direct_kill";
  animState: number;
  cooldown: number;
  triggerEveryHits: number;
  damageMultiplier: number;
  radius: number;
  summonItemId?: number;
  summonCount?: number;
}

interface ExtractedUnitBehavior {
  itemId: number;
  className: string;
  sourceKind: "isounit" | "delegate" | "group_default";
  isSpecialUnit: boolean;
  hasLimitBar: boolean;
  limitMax: number;
  scale: number;
  specials: ExtractedSpecialAttack[];
}

const SCRIPTS_ROOT = path.join(DECOMPILED_AS3_DIR, "scripts", "scripts");

function parseConstants(constantsPath: string): Map<string, number> {
  const map = new Map<string, number>();
  const text = fs.readFileSync(constantsPath, "utf-8");
  const re = /public static const ([A-Z0-9_]+)\s*:\s*(?:int|uint|Number)\s*=\s*(-?\d+)\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    map.set(m[1]!, Number(m[2]!));
  }
  return map;
}

function parseDelegatesManager(filePath: string, constants: Map<string, number>): Map<number, string> {
  const map = new Map<number, string>();
  const text = fs.readFileSync(filePath, "utf-8");
  const re = /registerDelegate\(\s*([A-Za-z0-9_]+)\s*,([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const cls = m[1]!;
    const argStr = m[2]!;
    for (const rawArg of argStr.split(",")) {
      const token = rawArg.trim();
      const constMatch = token.match(/Constants\.([A-Z0-9_]+)/);
      if (constMatch) {
        const val = constants.get(constMatch[1]!);
        if (val !== undefined) map.set(val, cls);
      } else if (/^\d+$/.test(token)) {
        map.set(Number(token), cls);
      }
    }
  }
  return map;
}

function parseIsoEngineSpecialUnits(filePath: string, constants: Map<string, number>): Map<number, string> {
  const map = new Map<number, string>();
  const text = fs.readFileSync(filePath, "utf-8");

  // Match if / else if blocks mapping one or more ID constants to `new Iso...(..)`
  const ifBlockRe = /(?:else\s+)?if\s*\(([^)]+)\)\s*\{\s*[^}]*?new\s+(Iso[A-Za-z0-9_]+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = ifBlockRe.exec(text)) !== null) {
    const cond = m[1]!;
    const cls = m[2]!;
    const idRe = /Constants\.([A-Z0-9_]+)/g;
    let cm: RegExpExecArray | null;
    while ((cm = idRe.exec(cond)) !== null) {
      const id = constants.get(cm[1]!);
      if (id !== undefined) map.set(id, cls);
    }
    const numRe = /==\s*(\d+)/g;
    let nm: RegExpExecArray | null;
    while ((nm = numRe.exec(cond)) !== null) {
      map.set(Number(nm[1]!), cls);
    }
  }

  // Also match switch/case statements
  const lines = text.split(/\r?\n/);
  let pendingIds: number[] = [];
  for (const line of lines) {
    const caseMatch = line.match(/case\s+Constants\.([A-Z0-9_]+)\s*:/);
    if (caseMatch) {
      const id = constants.get(caseMatch[1]!);
      if (id !== undefined) pendingIds.push(id);
      continue;
    }
    const newMatch = line.match(/new\s+(Iso[A-Za-z0-9_]+)\s*\(/);
    if (newMatch && pendingIds.length > 0) {
      const cls = newMatch[1]!;
      for (const id of pendingIds) map.set(id, cls);
      pendingIds = [];
      continue;
    }
    if (line.includes("break;") || line.includes("default:")) pendingIds = [];
  }
  return map;
}

function inferSpecialKind(src: string): ExtractedSpecialAttack["kind"] {
  if (/SpawnMinionSpecialAttack|spawnMinion/i.test(src)) return "spawn_minion";
  if (/WhirlwindSpecialAttack|whirlwind/i.test(src)) return "whirlwind";
  if (/RainSpecialAttack|Rain|Meteor|ArrowRain/i.test(src)) return "rain";
  if (/Beam|Laser|Ray/i.test(src)) return "beam";
  if (/EnergyBallsSpecialAttack|energyBall/i.test(src)) return "energy_balls";
  if (/Heal|Curar/i.test(src)) return "heal_aura";
  if (/Freeze|Ice|Frost/i.test(src)) return "freeze";
  if (/Poison/i.test(src)) return "poison";
  if (/Incinerate|Fire/i.test(src)) return "incinerate";
  if (/Dizzy/i.test(src)) return "dizzy";
  if (/PushInAir/i.test(src)) return "push_in_air";
  if (/DirectKill/i.test(src)) return "direct_kill";
  return "area_damage";
}

function parseClassSource(
  className: string,
  filePath: string,
  constants: Map<string, number>
): Omit<ExtractedUnitBehavior, "itemId" | "sourceKind"> {
  const src = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : "";
  const hasLimitBar = /extends\s+IsoLimitUnit|LimitDelegate|initLightingLimit|onSmashAttack/.test(src);
  const isSpecialUnit = /extends\s+Iso(?:Special|Limit)Unit|addSpecialUnitAttack/.test(src) || hasLimitBar;

  let scale = 1.0;
  const scaleMatch = src.match(/get\s+scale\s*\(\)\s*:\s*Number\s*\{[^}]*return\s+([0-9.]+)/);
  if (scaleMatch) {
    const parsed = Number(scaleMatch[1]);
    if (Number.isFinite(parsed) && parsed > 0.3 && parsed < 3.0) scale = parsed;
  }

  let cooldown = 24;
  const cdMatch = src.match(/COOLDOWN[^=]*=\s*(\d+)/);
  if (cdMatch) cooldown = Number(cdMatch[1]);

  const specials: ExtractedSpecialAttack[] = [];

  // Extract SpecialUnitAttackCreator names if present
  const attackNames: string[] = [];
  const nameRe = /withAttackName\(\s*"([^"]+)"\s*\)/g;
  let nm: RegExpExecArray | null;
  while ((nm = nameRe.exec(src)) !== null) {
    attackNames.push(nm[1]!);
  }

  // Extract explicit SpecialAttack instantiations
  const specRe = /new\s+([A-Za-z0-9_]+SpecialAttack)\s*\(([^;]+)\)/g;
  let sm: RegExpExecArray | null;
  let sIdx = 0;
  while ((sm = specRe.exec(src)) !== null) {
    const ctor = sm[1]!;
    const args = sm[2]!;
    const kind = inferSpecialKind(`${ctor} ${args}`);
    let animState = 6 + (sIdx % 4);
    const animMatch = args.match(/ANIMATION_ATTACKING_SPECIAL(\d)/);
    if (animMatch) animState = 5 + Number(animMatch[1]);

    let summonItemId: number | undefined;
    let summonCount: number | undefined;
    if (kind === "spawn_minion") {
      const cMatch = args.match(/Constants\.(ID_UNIT_[A-Z0-9_]+)/);
      if (cMatch) summonItemId = constants.get(cMatch[1]!);
      summonCount = 2;
    }

    specials.push({
      id: `${className}_sp${sIdx + 1}`,
      name: attackNames[sIdx] ?? `${ctor.replace("SpecialAttack", "")} ${sIdx + 1}`,
      kind,
      animState,
      cooldown,
      triggerEveryHits: 4 + sIdx * 2,
      damageMultiplier: kind === "spawn_minion" ? 1.0 : 2.0,
      radius: kind === "whirlwind" ? 3.5 : 4.5,
      summonItemId,
      summonCount
    });
    sIdx += 1;
  }

  // Fallback for Delegate classes that implement onAttack / whirlwind / beam imperatively
  if (specials.length === 0 && src.length > 0) {
    const kind = inferSpecialKind(src);
    const hasSpecialAnim = /ANIMATION_ATTACKING_SPECIAL1/.test(src);
    if (hasSpecialAnim || /Beam|Whirlwind|Rain|Spawn|Minion|Dragon|God|Colossus|Titan|Hero|Phoenix/i.test(className)) {
      specials.push({
        id: `${className}_auto1`,
        name: attackNames[0] ?? "Special Attack",
        kind,
        animState: hasSpecialAnim ? 6 : 2,
        cooldown,
        triggerEveryHits: 4,
        damageMultiplier: 1.85,
        radius: kind === "whirlwind" ? 3.5 : 4.0
      });
    }
  }

  return {
    className,
    isSpecialUnit,
    hasLimitBar,
    limitMax: hasLimitBar ? 100 : 0,
    scale,
    specials
  };
}

function main(): void {
  const constantsPath = path.join(SCRIPTS_ROOT, "core", "Constants.as");
  const delegatesMgrPath = path.join(SCRIPTS_ROOT, "core", "isoengine", "delegates", "DelegatesManager.as");
  const isoEnginePath = path.join(SCRIPTS_ROOT, "core", "isoengine", "IsoEngine.as");
  const itemsPath = path.join(GAME_DATA_DIR, "items.json");

  if (!fs.existsSync(constantsPath) || !fs.existsSync(itemsPath)) {
    throw new Error("Missing decompiled AS3 or items.json. Run 'pnpm assets:data && pnpm assets:decompile' first.");
  }

  const constants = parseConstants(constantsPath);
  const delegateByItem = parseDelegatesManager(delegatesMgrPath, constants);
  const isoUnitByItem = parseIsoEngineSpecialUnits(isoEnginePath, constants);
  const items = JSON.parse(fs.readFileSync(itemsPath, "utf-8")) as GameItem[];

  const behaviors: Record<string, ExtractedUnitBehavior> = {};
  let fromIsoUnit = 0;
  let fromDelegate = 0;
  let fromGroupDefault = 0;

  for (const item of items) {
    if (item.type !== "u") continue;

    const isoCls = isoUnitByItem.get(item.id);
    const delCls = delegateByItem.get(item.id);

    if (isoCls) {
      const fp = path.join(SCRIPTS_ROOT, "core", "isoengine", "isounits", `${isoCls}.as`);
      const parsed = parseClassSource(isoCls, fp, constants);
      behaviors[String(item.id)] = { itemId: item.id, sourceKind: "isounit", ...parsed };
      fromIsoUnit += 1;
    } else if (delCls) {
      const fp = path.join(SCRIPTS_ROOT, "core", "isoengine", "delegates", `${delCls}.as`);
      const parsed = parseClassSource(delCls, fp, constants);
      behaviors[String(item.id)] = { itemId: item.id, sourceKind: "delegate", ...parsed };
      fromDelegate += 1;
    } else {
      // Standard combat unit (melee / ranged / siege / worker / dragon default)
      const isDragon = item.groups.includes("dragon") || item.groups.includes("god");
      behaviors[String(item.id)] = {
        itemId: item.id,
        className: "StandardIsoUnit",
        sourceKind: "group_default",
        isSpecialUnit: isDragon,
        hasLimitBar: false,
        limitMax: 0,
        scale: 1.0,
        specials: isDragon
          ? [
              {
                id: `unit_${item.id}_breath`,
                name: "Dragon Breath",
                kind: "beam",
                animState: 6,
                cooldown: 20,
                triggerEveryHits: 4,
                damageMultiplier: 1.8,
                radius: 3.5
              }
            ]
          : []
      };
      fromGroupDefault += 1;
    }
  }

  const outPath = path.join(GAME_DATA_DIR, "unit_behaviors.json");
  fs.writeFileSync(outPath, JSON.stringify(behaviors));
  console.log("[extract-unit-behaviors] Generated unit_behaviors.json:", {
    totalUnitsCovered: Object.keys(behaviors).length,
    fromIsoUnit,
    fromDelegate,
    fromGroupDefault,
    totalWithSpecials: Object.values(behaviors).filter((b) => b.specials.length > 0).length,
    totalWithLimitBar: Object.values(behaviors).filter((b) => b.hasLimitBar).length
  });
}

main();
