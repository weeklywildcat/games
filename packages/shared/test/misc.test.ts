import { describe, expect, it } from "vitest";
import { dayKey, dayInRange, inQuietWindow } from "../src/time.ts";
import { generateNickname, isValidNickname, suggestNicknames } from "../src/nicknames.ts";
import { createRng, hashString, sample, shuffle } from "../src/rng.ts";
import { findBlockedWords, isBlockedWord } from "../src/moderation.ts";
import { DEFAULT_SETTINGS, settingsSchema } from "../src/settings.ts";

describe("time", () => {
  it("uses the school's timezone for days", () => {
    // 11:30 p.m. Eastern on Oct 26 is already Oct 27 in UTC.
    expect(dayKey(new Date("2026-10-27T03:30:00Z"), "America/New_York")).toBe("2026-10-26");
    expect(dayKey(new Date("2026-10-27T04:30:00Z"), "America/New_York")).toBe("2026-10-27");
    expect(dayInRange("2026-10-28", "2026-10-26", "2026-10-30")).toBe(true);
    expect(dayInRange("2026-10-31", "2026-10-26", "2026-10-30")).toBe(false);
  });

  it("handles overnight quiet windows", () => {
    const weeknights = [{ days: [1, 2, 3, 4, 5], start: "16:30", end: "07:00" }];
    // Monday 5 p.m. Eastern (21:00Z during DST).
    expect(inQuietWindow(weeknights, new Date("2026-10-26T21:00:00Z"))).toBe(true);
    // Tuesday 6 a.m. Eastern: still inside Monday's window.
    expect(inQuietWindow(weeknights, new Date("2026-10-27T10:00:00Z"))).toBe(true);
    // Tuesday noon: open.
    expect(inQuietWindow(weeknights, new Date("2026-10-27T16:00:00Z"))).toBe(false);
    // Saturday 6 a.m.: Friday's window ends at 7.
    expect(inQuietWindow(weeknights, new Date("2026-10-31T10:00:00Z"))).toBe(true);
    // Sunday 6 a.m.: no Saturday window.
    expect(inQuietWindow(weeknights, new Date("2026-11-01T11:00:00Z"))).toBe(false);
  });
});

describe("nicknames", () => {
  it("only accepts names the generator could produce", () => {
    const names = suggestNicknames(20, 123);
    expect(new Set(names).size).toBe(20);
    expect(names.every(isValidNickname)).toBe(true);
    expect(isValidNickname(generateNickname(createRng(5)))).toBe(true);
    expect(isValidNickname("Bold Otter 07")).toBe(false);
    expect(isValidNickname("Bold Otter 100")).toBe(false);
    expect(isValidNickname("Jane Smith 12")).toBe(false);
    expect(isValidNickname("bold otter 12")).toBe(false);
    expect(isValidNickname("Bold  Otter 12")).toBe(false);
  });
});

describe("rng", () => {
  it("is deterministic and shuffles without loss", () => {
    const a = shuffle([1, 2, 3, 4, 5, 6], createRng(hashString("2026-10-26:word")));
    const b = shuffle([1, 2, 3, 4, 5, 6], createRng(hashString("2026-10-26:word")));
    expect(a).toEqual(b);
    expect([...a].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(new Set(sample([1, 2, 3, 4, 5], 3, createRng(1))).size).toBe(3);
  });
});

describe("moderation", () => {
  it("blocks offensive words without catching innocent ones", () => {
    expect(isBlockedWord("canal")).toBe(false);
    expect(isBlockedWord("peacock")).toBe(false);
    expect(isBlockedWord("cumin")).toBe(false);
    expect(isBlockedWord("document")).toBe(false);
    expect(isBlockedWord("Scunthorpe")).toBe(true); // a known false positive of root matching, accepted for safety
    expect(findBlockedWords("A friendly question about trees?")).toEqual([]);
  });
});

describe("settings", () => {
  it("ships valid defaults with launch week", () => {
    expect(settingsSchema.parse(DEFAULT_SETTINGS)).toBeTruthy();
    expect(DEFAULT_SETTINGS.event).toEqual({ name: "Launch Week", start: "2026-10-26", end: "2026-10-30" });
    expect(DEFAULT_SETTINGS.sound.enabled).toBe(false);
    expect(DEFAULT_SETTINGS.idle.timeoutSeconds).toBe(120);
    expect(DEFAULT_SETTINGS.idle.warningSeconds).toBe(20);
  });

  it("rejects inconsistent values", () => {
    const bad = structuredClone(DEFAULT_SETTINGS);
    bad.idle.warningSeconds = 200;
    expect(settingsSchema.safeParse(bad).success).toBe(false);
    const badDates = structuredClone(DEFAULT_SETTINGS);
    badDates.challenge.end = "2026-10-01";
    expect(settingsSchema.safeParse(badDates).success).toBe(false);
  });
});
