/**
 * Builds content/word/valid-guesses.json from the SCOWL-derived `wordlist-english`
 * package (sizes 10–70, English + American spellings), removing blocked words.
 * Also checks content/word/answers.json: every answer must be a common word.
 *
 *   npx tsx scripts/build-dictionary.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { isBlockedWord } from "../packages/shared/src/moderation.ts";

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve("wordlist-english/package.json"));
const root = join(import.meta.dirname, "..");
const SIZES = [10, 20, 35, 40, 50, 55, 60, 70];
const COMMON_SIZES = [10, 20, 35, 40, 50];

function load(sizes: number[]): Set<string> {
  const out = new Set<string>();
  for (const lang of ["english", "american"]) {
    for (const size of sizes) {
      const words: string[] = JSON.parse(readFileSync(join(pkgDir, `${lang}-words-${size}.json`), "utf8"));
      for (const w of words) if (/^[a-z]{5}$/.test(w) && !isBlockedWord(w)) out.add(w);
    }
  }
  return out;
}

const all = load(SIZES);
const common = load(COMMON_SIZES);
const answers: string[] = JSON.parse(readFileSync(join(root, "content/word/answers.json"), "utf8"));
for (const a of answers) all.add(a);
const guesses = [...all].sort();
writeFileSync(join(root, "content/word/valid-guesses.json"), JSON.stringify(guesses) + "\n");

// Difficulty tier from SCOWL frequency size: 1 = most common … 4 = least common.
const tiers: Record<string, number> = {};
const tierSets = [load([10]), load([10, 20]), load([10, 20, 35])];
for (const a of answers) tiers[a] = tierSets.findIndex((s) => s.has(a)) + 1 || 4;
writeFileSync(join(root, "content/word/answer-tiers.json"), JSON.stringify(tiers) + "\n");

const problems = answers.filter((a) => !common.has(a) || isBlockedWord(a));
const dupes = answers.filter((a, i) => answers.indexOf(a) !== i);
console.log(`valid guesses: ${guesses.length}; answers: ${answers.length}`);
if (problems.length) console.log("answers outside the common lists:", problems.join(" "));
if (dupes.length) console.log("duplicate answers:", dupes.join(" "));
writeFileSync(join(root, "content/word/LICENSE-SCOWL.txt"), readFileSync(join(pkgDir, "Copyright"), "utf8"));
