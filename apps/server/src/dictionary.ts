import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isBlockedWord } from "@wildcat/shared";

/** The Word guess dictionary, plus per-answer difficulty tiers from the content build. */
export class Dictionary {
  readonly guesses: Set<string>;
  readonly tiers: Record<string, number>;

  constructor(contentDir: string) {
    const guessPath = join(contentDir, "word/valid-guesses.json");
    const tierPath = join(contentDir, "word/answer-tiers.json");
    const words: string[] = existsSync(guessPath) ? JSON.parse(readFileSync(guessPath, "utf8")) : [];
    this.guesses = new Set(words.filter((w) => /^[a-z]{5}$/.test(w) && !isBlockedWord(w)));
    this.tiers = existsSync(tierPath) ? JSON.parse(readFileSync(tierPath, "utf8")) : {};
  }

  /** Answers are always valid guesses even if the dictionary lacks them. */
  isValidGuess(word: string, extraAnswers?: ReadonlySet<string>): boolean {
    const w = word.toLowerCase();
    if (isBlockedWord(w)) return false;
    return this.guesses.has(w) || Boolean(extraAnswers?.has(w));
  }

  tier(word: string): number {
    return this.tiers[word] ?? 3;
  }
}
