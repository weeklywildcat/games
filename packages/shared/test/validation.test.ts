import { describe, expect, it } from "vitest";
import { validateContent } from "../src/validation.ts";

const goodPuzzle = {
  groups: [
    { level: 1, category: "Reds", members: ["CRIMSON", "SCARLET", "RUBY", "CHERRY"], explanation: "Reds." },
    { level: 2, category: "Trees", members: ["OAK", "ASPEN", "BIRCH", "WILLOW"], explanation: "Trees." },
    { level: 3, category: "Keys", members: ["PIANO", "MAP", "LOCK", "FLORIDA"], explanation: "Keys." },
    { level: 4, category: "Hidden body parts", members: ["CHINA", "SHINY", "PEARL", "SHIPS"], explanation: "Hidden." },
  ],
};

describe("connections validation", () => {
  it("accepts a well-formed puzzle", () => {
    const r = validateContent("connections", goodPuzzle);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("catches duplicate words across groups", () => {
    const p = structuredClone(goodPuzzle);
    p.groups[1].members[0] = "ruby";
    const r = validateContent("connections", p);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.message.includes("more than once"))).toBe(true);
  });

  it("requires four groups of four and distinct levels", () => {
    expect(validateContent("connections", { groups: goodPuzzle.groups.slice(0, 3) }).ok).toBe(false);
    const short = structuredClone(goodPuzzle);
    (short.groups[0].members as string[]).pop();
    expect(validateContent("connections", short).ok).toBe(false);
    const levels = structuredClone(goodPuzzle);
    levels.groups[3].level = 1;
    expect(validateContent("connections", levels).errors.some((e) => e.message.includes("difficulty level"))).toBe(true);
  });

  it("warns about tiles that contain each other", () => {
    const p = structuredClone(goodPuzzle);
    p.groups[0].members[3] = "MAPLE";
    expect(validateContent("connections", p).warnings.some((w) => w.message.includes("contains"))).toBe(true);
  });
});

describe("trivia validation", () => {
  const q = { category: "general", prompt: "How many legs does a spider have?", choices: ["6", "8", "10", "12"], answerIndex: 1, explanation: "Arachnids." };

  it("accepts a clean question", () => {
    expect(validateContent("trivia", q).ok).toBe(true);
  });

  it("rejects duplicate choices and bad answer keys", () => {
    expect(validateContent("trivia", { ...q, choices: ["8", "8 ", "10", "12"] }).ok).toBe(false);
    expect(validateContent("trivia", { ...q, answerIndex: 4 }).ok).toBe(false);
    expect(validateContent("trivia", { ...q, choices: ["6", "8", "10"] }).ok).toBe(false);
    expect(validateContent("trivia", { ...q, category: "made-up" }).ok).toBe(false);
  });

  it("requires a verified source for school questions when publishing", () => {
    const school = { ...q, category: "nshs-history", prompt: "In what year did the school open?" };
    expect(validateContent("trivia", school).ok).toBe(true);
    const pub = validateContent("trivia", school, { forPublish: true, verification: { status: "unverified", sources: [], notes: "" } });
    expect(pub.ok).toBe(false);
    const verified = validateContent("trivia", school, { forPublish: true, verification: { status: "verified", sources: ["School records, 2026"], notes: "" } });
    expect(verified.ok).toBe(true);
  });
});

describe("word and match validation", () => {
  it("validates answers", () => {
    expect(validateContent("word", { answer: "crane" }, { dictionary: new Set(["crane"]) }).ok).toBe(true);
    expect(validateContent("word", { answer: "cranes" }).ok).toBe(false);
    expect(validateContent("word", { answer: "cr4ne" }).ok).toBe(false);
    expect(validateContent("word", { answer: "zzzzz" }, { dictionary: new Set(["crane"]) }).warnings.length).toBeGreaterThan(0);
  });

  const theme = {
    name: "Test",
    back: "dots",
    items: ["Camera", "Rocket", "Trophy", "Music", "Star", "Moon"].map((icon, i) => ({ id: icon.toLowerCase(), label: icon, icon, color: ["#E4572E", "#F0A202", "#2BA84A", "#2D7DD2", "#7B4FD6", "#E83F8C"][i] })),
  };

  it("validates match themes, icons, and images", () => {
    expect(validateContent("match", theme).ok).toBe(true);
    const unknown = structuredClone(theme);
    unknown.items[0].icon = "NotAnIcon";
    expect(validateContent("match", unknown).ok).toBe(false);
    const dupe = structuredClone(theme);
    dupe.items[1].icon = "Camera";
    expect(validateContent("match", dupe).ok).toBe(false);
    const missingImage = structuredClone(theme) as { items: Record<string, unknown>[] };
    delete missingImage.items[0].icon;
    missingImage.items[0].imageId = "abc123";
    expect(validateContent("match", missingImage, { imageIds: new Set() }).ok).toBe(false);
    expect(validateContent("match", { ...theme, items: theme.items.slice(0, 5) }).ok).toBe(false);
  });
});
