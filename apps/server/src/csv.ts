import type { ContentType } from "@wildcat/shared";
import { HttpError } from "./http.ts";

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === "") quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

/**
 * Converts CSV rows (with a header row) into content records.
 *  - word:   answer
 *  - trivia: category, difficulty, prompt, choice_a, choice_b, choice_c, choice_d, correct (A–D or 1–4), explanation, source
 * Connections and Mini Match are structured, so they import as JSON only.
 */
export function recordsFromCsv(type: ContentType, rows: string[][]): unknown[] {
  if (rows.length < 2) throw new HttpError(400, "The CSV needs a header row and at least one data row");
  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const col = (name: string) => header.indexOf(name);
  const get = (row: string[], name: string) => (col(name) >= 0 ? (row[col(name)] ?? "").trim() : "");
  const body = rows.slice(1);

  if (type === "word") {
    if (col("answer") < 0) throw new HttpError(400, 'Word CSV needs an "answer" column');
    return body.map((r) => ({ type: "word", data: { answer: get(r, "answer").toLowerCase() }, difficulty: 2 }));
  }
  if (type === "trivia") {
    for (const need of ["category", "prompt", "choice_a", "choice_b", "choice_c", "choice_d", "correct"]) {
      if (col(need) < 0) throw new HttpError(400, `Trivia CSV needs a "${need}" column`);
    }
    return body.map((r) => {
      const correct = get(r, "correct").toUpperCase();
      const answerIndex = /^[A-D]$/.test(correct) ? correct.charCodeAt(0) - 65 : Number(correct) - 1;
      const source = get(r, "source");
      return {
        type: "trivia",
        difficulty: Number(get(r, "difficulty")) || 2,
        data: {
          category: get(r, "category"),
          prompt: get(r, "prompt"),
          choices: [get(r, "choice_a"), get(r, "choice_b"), get(r, "choice_c"), get(r, "choice_d")],
          answerIndex,
          explanation: get(r, "explanation") || undefined,
        },
        verification: { status: "unverified", sources: source ? [source] : [], notes: "" },
      };
    });
  }
  throw new HttpError(400, "This game imports JSON only");
}
