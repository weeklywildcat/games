/**
 * Validates the bundled content bank (content/*.json) with the same rules the
 * admin dashboard uses. Exits non-zero on any error; warnings are listed for
 * editors to review.
 *
 *   npm run content:validate
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isBlockedWord, validateContent, type ValidationIssue } from "../packages/shared/src/index.ts";

const root = join(import.meta.dirname, "..", "content");
const read = (p: string) => JSON.parse(readFileSync(join(root, p), "utf8"));
const dictionary = new Set<string>(read("word/valid-guesses.json"));
let errors = 0;
let warnings = 0;

function report(label: string, r: { errors: ValidationIssue[]; warnings: ValidationIssue[] }) {
  for (const e of r.errors) {
    errors++;
    console.log(`ERROR  ${label}: ${e.message} (${e.path})`);
  }
  for (const w of r.warnings) {
    warnings++;
    if (process.argv.includes("--warnings")) console.log(`check  ${label}: ${w.message} (${w.path})`);
  }
}

const answers: string[] = read("word/answers.json");
const seen = new Set<string>();
for (const a of answers) {
  if (seen.has(a)) report(`word ${a}`, { errors: [{ path: "answer", message: "duplicate answer" }], warnings: [] });
  seen.add(a);
  report(`word ${a}`, validateContent("word", { answer: a }, { dictionary }));
}
for (const w of dictionary) if (isBlockedWord(w)) report(`dictionary ${w}`, { errors: [{ path: "", message: "blocked word in guess list" }], warnings: [] });

for (const p of read("connections.json")) report(p.id, validateContent("connections", { groups: p.groups, title: p.title }));

const trivia = read("trivia.json").questions as [string, number, string, string[], number, string][];
trivia.forEach(([category, , prompt, choices, answerIndex, explanation], i) =>
  report(`trivia #${i + 1}`, validateContent("trivia", { category, prompt, choices, answerIndex, explanation }, { forPublish: true })),
);
for (const q of read("trivia-review.json").questions) {
  report(q.id, validateContent("trivia", q.data, { forPublish: false }));
  if (q.status === "published" || q.status === "approved") report(q.id, { errors: [{ path: "status", message: "review items must not ship published" }], warnings: [] });
}
for (const t of read("match.json")) report(t.id, validateContent("match", t.data));

console.log(
  `\n${answers.length} word answers, ${dictionary.size} valid guesses, ${read("connections.json").length} Connections puzzles, ${trivia.length} trivia questions (+${read("trivia-review.json").questions.length} awaiting review), ${read("match.json").length} Mini Match themes.`,
);
console.log(`${errors} errors, ${warnings} warnings${warnings && !process.argv.includes("--warnings") ? " (run with --warnings to list them)" : ""}.`);
process.exit(errors ? 1 : 0);
