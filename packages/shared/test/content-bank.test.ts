import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isBlockedWord } from "../src/moderation.ts";
import { validateContent } from "../src/validation.ts";

/** The bundled content bank must always be clean: these run on every CI build. */
const root = join(import.meta.dirname, "../../../content");
const read = (p: string) => JSON.parse(readFileSync(join(root, p), "utf8"));

describe("bundled content bank", () => {
  const dictionary = new Set<string>(read("word/valid-guesses.json"));

  it("has at least 300 curated Word answers, all valid guesses", () => {
    const answers: string[] = read("word/answers.json");
    expect(answers.length).toBeGreaterThanOrEqual(300);
    expect(new Set(answers).size).toBe(answers.length);
    for (const a of answers) {
      expect(a).toMatch(/^[a-z]{5}$/);
      expect(dictionary.has(a)).toBe(true);
      expect(isBlockedWord(a)).toBe(false);
    }
  });

  it("keeps blocked words out of the guess dictionary", () => {
    expect([...dictionary].filter(isBlockedWord)).toEqual([]);
  });

  it("has 40+ Connections puzzles with no validation errors and unique ids", () => {
    const puzzles: { id: string; groups: unknown[] }[] = read("connections.json");
    expect(puzzles.length).toBeGreaterThanOrEqual(40);
    expect(new Set(puzzles.map((p) => p.id)).size).toBe(puzzles.length);
    for (const p of puzzles) {
      const r = validateContent("connections", { groups: p.groups });
      expect(r.errors, p.id).toEqual([]);
    }
  });

  it("has 150+ trivia questions with no validation errors", () => {
    const { questions } = read("trivia.json") as { questions: [string, number, string, string[], number, string][] };
    expect(questions.length).toBeGreaterThanOrEqual(150);
    const prompts = new Set<string>();
    for (const [category, , prompt, choices, answerIndex, explanation] of questions) {
      const r = validateContent("trivia", { category, prompt, choices, answerIndex, explanation }, { forPublish: true });
      expect(r.errors, prompt).toEqual([]);
      expect(prompts.has(prompt), `duplicate prompt: ${prompt}`).toBe(false);
      prompts.add(prompt);
    }
  });

  it("never publishes school or local questions from the seed", () => {
    const { questions } = read("trivia-review.json") as { questions: { status: string; verification: { status: string } }[] };
    for (const q of questions) {
      expect(q.status).not.toBe("published");
      expect(q.status).not.toBe("approved");
      expect(q.verification.status).not.toBe("verified");
    }
  });

  it("has 20+ Mini Match themes with distinct, known icons", () => {
    const themes: { id: string; data: unknown }[] = read("match.json");
    expect(themes.length).toBeGreaterThanOrEqual(20);
    for (const t of themes) {
      const r = validateContent("match", t.data);
      expect(r.errors, t.id).toEqual([]);
    }
  });
});
