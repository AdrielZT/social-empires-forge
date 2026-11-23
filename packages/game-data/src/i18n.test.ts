import { describe, expect, it } from "vitest";
import { getUiStrings } from "./i18n.js";

describe("bilingual i18n (ES/EN)", () => {
  it("provides complete Spanish and English UI strings with matching keys", () => {
    const es = getUiStrings("es");
    const en = getUiStrings("en");
    expect(es.resources.gold).toBe("Oro");
    expect(en.resources.gold).toBe("Gold");
    expect(Object.keys(es.hud).sort()).toEqual(Object.keys(en.hud).sort());
    expect(Object.keys(es.biomes).sort()).toEqual(Object.keys(en.biomes).sort());
  });
});
