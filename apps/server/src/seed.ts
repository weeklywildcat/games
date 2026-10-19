import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ContentRecordInput } from "@wildcat/shared";
import type { AppContext } from "./context.ts";
import { createContent } from "./content.ts";
import { log } from "./log.ts";

/**
 * Loads the bundled content bank. Every seed record has a stable id recorded in
 * `seed_log`, so updates add new puzzles without resurrecting anything an
 * editor deleted or overwriting their edits.
 */

type TriviaTuple = [string, number, string, string[], number, string];

function readJson<T>(path: string): T | null {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : null;
}

export function seedRecords(contentDir: string, tiers: Record<string, number>): ContentRecordInput[] {
  const out: ContentRecordInput[] = [];
  const seededNote = { status: "unverified" as const, sources: [], notes: "Seed content bundled with Wildcat Games." };

  for (const answer of readJson<string[]>(join(contentDir, "word/answers.json")) ?? []) {
    const tier = tiers[answer] ?? 3;
    out.push({
      id: `word-${answer}`,
      type: "word",
      status: "published",
      ranked: tier <= 3,
      difficulty: tier,
      data: { answer },
      verification: seededNote,
    });
  }

  for (const p of readJson<{ id: string; difficulty: number; tags?: string[]; title?: string; groups: unknown[] }[]>(join(contentDir, "connections.json")) ?? []) {
    out.push({
      id: p.id,
      type: "connections",
      status: "published",
      ranked: true,
      difficulty: p.difficulty,
      tags: p.tags ?? [],
      data: { title: p.title, groups: p.groups },
      verification: { ...seededNote, notes: "Seed puzzle, checked by hand for a single valid solution." },
    });
  }

  const trivia = readJson<{ questions: TriviaTuple[] }>(join(contentDir, "trivia.json"));
  trivia?.questions.forEach(([category, difficulty, prompt, choices, answerIndex, explanation], i) => {
    out.push({
      id: `trivia-${String(i + 1).padStart(3, "0")}`,
      type: "trivia",
      status: "published",
      ranked: true,
      difficulty,
      data: { category, prompt, choices, answerIndex, explanation },
      verification: { ...seededNote, notes: "General-knowledge seed question. Spot-check before launch." },
    });
  });

  const review = readJson<{ questions: (ContentRecordInput & { id: string })[] }>(join(contentDir, "trivia-review.json"));
  for (const q of review?.questions ?? []) out.push({ ...q, type: "trivia", ranked: false });

  for (const t of readJson<{ id: string; difficulty: number; data: unknown }[]>(join(contentDir, "match.json")) ?? []) {
    out.push({ id: t.id, type: "match", status: "published", ranked: true, difficulty: t.difficulty, data: t.data, verification: seededNote });
  }
  return out;
}

export function applySeed(ctx: AppContext): { created: number; skipped: number; failed: number } {
  const applied = new Set(ctx.db.all<{ id: string }>("SELECT id FROM seed_log").map((r) => r.id));
  const records = seedRecords(ctx.config.contentDir, ctx.dictionary.tiers);
  let created = 0;
  let skipped = 0;
  let failed = 0;
  ctx.db.tx(() => {
    for (const rec of records) {
      if (!rec.id || applied.has(rec.id)) {
        skipped++;
        continue;
      }
      try {
        if (!ctx.db.get("SELECT 1 FROM content_items WHERE id = ?", [rec.id])) {
          // Published seed items are pre-approved; createContent still validates them.
          const status = rec.status === "published" ? "approved" : (rec.status ?? "draft");
          createContent(ctx, { ...rec, status } as Parameters<typeof createContent>[1], "seed", "seed");
          if (rec.status === "published") {
            ctx.db.run("UPDATE content_items SET status = 'published' WHERE id = ?", [rec.id]);
          }
          created++;
        }
        ctx.db.run("INSERT OR IGNORE INTO seed_log (id, applied_at) VALUES (?, ?)", [rec.id, new Date().toISOString()]);
      } catch (err) {
        failed++;
        log.warn("Seed record rejected", { id: rec.id, error: (err as Error).message });
      }
    }
  });
  if (created) log.info("Seeded content", { created, failed });
  return { created, skipped, failed };
}
