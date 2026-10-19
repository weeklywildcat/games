import { randomUUID } from "node:crypto";
import {
  CONTENT_STATUSES,
  contentRecordSchema,
  validateContent,
  verificationSchema,
  type ContentItem,
  type ContentStatus,
  type ContentType,
  type ValidationResult,
  type Verification,
} from "@wildcat/shared";
import type { AppContext } from "./context.ts";

/** Content repository: puzzles, questions, and themes for every game. */

interface ContentRow {
  id: string;
  type: ContentType;
  status: ContentStatus;
  ranked: number;
  difficulty: number;
  tags: string;
  data: string;
  verification: string;
  origin: string;
  created_at: string;
  updated_at: string;
  approved_by: string | null;
  approved_at: string | null;
  times_served: number;
  last_served_at: string | null;
}

export function rowToItem<T extends ContentType>(row: ContentRow): ContentItem<T> {
  return {
    id: row.id,
    type: row.type as T,
    status: row.status,
    ranked: row.ranked === 1,
    difficulty: row.difficulty,
    tags: JSON.parse(row.tags),
    data: JSON.parse(row.data),
    verification: JSON.parse(row.verification),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    timesServed: row.times_served,
    lastServedAt: row.last_served_at,
  };
}

function searchText(type: ContentType, data: unknown, tags: string[]): string {
  const d = data as Record<string, unknown>;
  const parts: string[] = [type, ...tags];
  if (type === "word") parts.push(String(d.answer ?? ""));
  if (type === "trivia") parts.push(String(d.prompt ?? ""), ...((d.choices as string[]) ?? []), String(d.category ?? ""));
  if (type === "connections") {
    for (const g of (d.groups as { category: string; members: string[] }[]) ?? []) parts.push(g.category, ...g.members);
    if (d.title) parts.push(String(d.title));
  }
  if (type === "match") {
    parts.push(String(d.name ?? ""));
    for (const i of (d.items as { label: string }[]) ?? []) parts.push(i.label);
  }
  return parts.join(" ").toLowerCase();
}

export function imageIds(ctx: AppContext): Set<string> {
  return new Set(ctx.db.all<{ id: string }>("SELECT id FROM uploads").map((r) => r.id));
}

export function validateItem(
  ctx: AppContext,
  type: ContentType,
  data: unknown,
  verification: Verification | undefined,
  forPublish: boolean,
): ValidationResult {
  return validateContent(type, data, {
    dictionary: ctx.dictionary.guesses,
    imageIds: type === "match" ? imageIds(ctx) : undefined,
    verification,
    forPublish,
  });
}

export interface ListOptions {
  type?: ContentType;
  status?: ContentStatus | "active";
  q?: string;
  ranked?: boolean;
  limit?: number;
  offset?: number;
}

export function listContent(ctx: AppContext, opts: ListOptions) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts.type) {
    where.push("type = ?");
    params.push(opts.type);
  }
  if (opts.status === "active") where.push("status != 'archived'");
  else if (opts.status) {
    where.push("status = ?");
    params.push(opts.status);
  }
  if (opts.ranked !== undefined) {
    where.push("ranked = ?");
    params.push(opts.ranked ? 1 : 0);
  }
  if (opts.q) {
    where.push("search LIKE ?");
    params.push(`%${opts.q.toLowerCase().replace(/[%_]/g, "")}%`);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);
  const total = ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM content_items ${clause}`, params)?.n ?? 0;
  const rows = ctx.db.all<ContentRow>(`SELECT * FROM content_items ${clause} ORDER BY updated_at DESC, id LIMIT ? OFFSET ?`, [...params, limit, offset]);
  return { total, items: rows.map((r) => rowToItem(r)) };
}

export function contentCounts(ctx: AppContext) {
  const rows = ctx.db.all<{ type: string; status: string; ranked: number; n: number }>(
    "SELECT type, status, ranked, COUNT(*) AS n FROM content_items GROUP BY type, status, ranked",
  );
  const out: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    out[r.type] ??= { total: 0, rankedPublished: 0 };
    out[r.type][r.status] = (out[r.type][r.status] ?? 0) + r.n;
    out[r.type].total += r.n;
    if (r.status === "published" && r.ranked) out[r.type].rankedPublished += r.n;
  }
  return out;
}

export function getContent(ctx: AppContext, id: string): ContentItem | null {
  const row = ctx.db.get<ContentRow>("SELECT * FROM content_items WHERE id = ?", [id]);
  return row ? rowToItem(row) : null;
}

/** Published items of a type, optionally ranked-only. */
export function publishedContent<T extends ContentType>(ctx: AppContext, type: T, rankedOnly = false): ContentItem<T>[] {
  const rows = ctx.db.all<ContentRow>(
    `SELECT * FROM content_items WHERE type = ? AND status = 'published' ${rankedOnly ? "AND ranked = 1" : ""} ORDER BY id`,
    [type],
  );
  return rows.map((r) => rowToItem<T>(r));
}

export function markServed(ctx: AppContext, ids: string[]) {
  const now = new Date().toISOString();
  for (const id of ids) ctx.db.run("UPDATE content_items SET times_served = times_served + 1, last_served_at = ? WHERE id = ?", [now, id]);
}

export class ContentError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly validation?: ValidationResult,
  ) {
    super(message);
  }
}

export interface ContentInput {
  id?: string;
  type: ContentType;
  status?: ContentStatus;
  ranked?: boolean;
  difficulty?: number;
  tags?: string[];
  data: unknown;
  verification?: Partial<Verification>;
}

export function createContent(ctx: AppContext, input: ContentInput, actor: string, origin = "admin") {
  const record = contentRecordSchema.parse({ ...input, status: input.status ?? "draft" });
  const verification = verificationSchema.parse(record.verification);
  const validation = validateItem(ctx, record.type, record.data, verification, false);
  if (!validation.data) throw new ContentError("The content doesn't match the expected format", 400, validation);
  if (record.status === "published" || record.status === "approved") {
    const pub = validateItem(ctx, record.type, record.data, verification, true);
    if (!pub.ok) throw new ContentError("Fix validation errors before approving or publishing", 400, pub);
  }
  const id = record.id && record.id.length > 0 ? record.id : `${record.type}-${randomUUID().slice(0, 8)}`;
  if (getContent(ctx, id)) throw new ContentError(`Content "${id}" already exists`, 409);
  const now = new Date().toISOString();
  const approved = record.status === "published" || record.status === "approved";
  ctx.db.run(
    `INSERT INTO content_items (id, type, status, ranked, difficulty, tags, data, verification, origin, search, created_at, updated_at, approved_by, approved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      record.type,
      record.status,
      record.ranked ? 1 : 0,
      record.difficulty,
      JSON.stringify(record.tags),
      JSON.stringify(validation.data),
      JSON.stringify(verification),
      origin,
      searchText(record.type, validation.data, record.tags),
      now,
      now,
      approved ? actor : null,
      approved ? now : null,
    ],
  );
  if (origin !== "seed") ctx.audit(actor, "content.create", id, { type: record.type, status: record.status });
  return { item: getContent(ctx, id)!, validation };
}

export interface ContentPatch {
  ranked?: boolean;
  difficulty?: number;
  tags?: string[];
  data?: unknown;
  verification?: Partial<Verification>;
}

export function updateContent(ctx: AppContext, id: string, patch: ContentPatch, actor: string) {
  const existing = getContent(ctx, id);
  if (!existing) throw new ContentError("Not found", 404);
  const data = patch.data ?? existing.data;
  const verification = verificationSchema.parse({ ...existing.verification, ...(patch.verification ?? {}) });
  const live = existing.status === "published" || existing.status === "approved";
  const validation = validateItem(ctx, existing.type, data, verification, live);
  if (!validation.data) throw new ContentError("The content doesn't match the expected format", 400, validation);
  if (live && !validation.ok) throw new ContentError("Published content must stay valid. Fix the errors or unpublish first.", 400, validation);
  const tags = patch.tags ?? existing.tags;
  const difficulty = patch.difficulty ?? existing.difficulty;
  if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) throw new ContentError("Difficulty must be 1–5");
  ctx.db.run(
    "UPDATE content_items SET ranked = ?, difficulty = ?, tags = ?, data = ?, verification = ?, search = ?, updated_at = ? WHERE id = ?",
    [
      (patch.ranked ?? existing.ranked) ? 1 : 0,
      difficulty,
      JSON.stringify(tags),
      JSON.stringify(validation.data),
      JSON.stringify(verification),
      searchText(existing.type, validation.data, tags),
      new Date().toISOString(),
      id,
    ],
  );
  ctx.audit(actor, "content.update", id, { fields: Object.keys(patch) });
  return { item: getContent(ctx, id)!, validation };
}

/**
 * Workflow transitions. Approving and publishing both require a clean
 * validation including verification rules; publishing requires approval first.
 */
export function setContentStatus(ctx: AppContext, id: string, status: ContentStatus, actor: string) {
  if (!CONTENT_STATUSES.includes(status)) throw new ContentError("Unknown status");
  const existing = getContent(ctx, id);
  if (!existing) throw new ContentError("Not found", 404);
  if (existing.status === status) return { item: existing, validation: null };
  let validation: ValidationResult | null = null;
  if (status === "approved" || status === "published") {
    validation = validateItem(ctx, existing.type, existing.data, existing.verification, true);
    if (!validation.ok) throw new ContentError("Fix validation errors first", 400, validation);
    if (status === "published" && existing.status !== "approved") {
      throw new ContentError("Approve this item before publishing it", 409);
    }
  }
  const now = new Date().toISOString();
  const approving = status === "approved";
  ctx.db.run(
    `UPDATE content_items SET status = ?, updated_at = ?,
       approved_by = CASE WHEN ? THEN ? WHEN ? IN ('draft','review') THEN NULL ELSE approved_by END,
       approved_at = CASE WHEN ? THEN ? WHEN ? IN ('draft','review') THEN NULL ELSE approved_at END
     WHERE id = ?`,
    [status, now, approving ? 1 : 0, actor, status, approving ? 1 : 0, now, status, id],
  );
  ctx.audit(actor, "content.status", id, { from: existing.status, to: status });
  return { item: getContent(ctx, id)!, validation };
}

export function deleteContent(ctx: AppContext, id: string, actor: string) {
  const existing = getContent(ctx, id);
  if (!existing) throw new ContentError("Not found", 404);
  if (existing.timesServed > 0 || existing.status === "published") {
    throw new ContentError("Content that has been played can only be archived, so history stays accurate", 409);
  }
  ctx.db.run("DELETE FROM content_items WHERE id = ?", [id]);
  ctx.audit(actor, "content.delete", id, { type: existing.type });
}

export function contentUsage(ctx: AppContext, id: string) {
  const like = `%"${id.replace(/[%_"]/g, "")}"%`;
  const byMode = ctx.db.all<{ mode: string; plays: number; completed: number; last: number | null }>(
    `SELECT mode, COUNT(*) AS plays, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed, MAX(started_at) AS last
       FROM game_sessions WHERE content_ids LIKE ? GROUP BY mode`,
    [like],
  );
  const recent = ctx.db.all<{ day: string; mode: string; status: string; score: number | null }>(
    "SELECT day, mode, status, score FROM game_sessions WHERE content_ids LIKE ? ORDER BY started_at DESC LIMIT 10",
    [like],
  );
  return { byMode: byMode.map((r) => ({ ...r, last: r.last ? new Date(r.last).toISOString() : null })), recent };
}

export interface ImportReport {
  created: string[];
  updated: string[];
  skipped: { id?: string; reason: string }[];
  errors: { index: number; id?: string; message: string; issues?: unknown }[];
}

/**
 * Imports content records. New items always land as drafts unless the
 * importer explicitly keeps statuses (seed only), so nothing skips review.
 */
export function importContent(
  ctx: AppContext,
  records: unknown[],
  actor: string,
  opts: { onExisting: "skip" | "update"; keepStatus?: boolean; origin?: string } = { onExisting: "skip" },
): ImportReport {
  const report: ImportReport = { created: [], updated: [], skipped: [], errors: [] };
  ctx.db.tx(() => {
    records.forEach((raw, index) => {
      const parsed = contentRecordSchema.safeParse(raw);
      if (!parsed.success) {
        report.errors.push({ index, message: "Invalid record", issues: parsed.error.issues.slice(0, 5) });
        return;
      }
      const rec = parsed.data;
      try {
        const existing = rec.id ? getContent(ctx, rec.id) : null;
        if (existing) {
          if (opts.onExisting === "skip") {
            report.skipped.push({ id: rec.id, reason: "exists" });
            return;
          }
          updateContent(ctx, existing.id, { data: rec.data, tags: rec.tags, difficulty: rec.difficulty, ranked: rec.ranked, verification: rec.verification }, actor);
          report.updated.push(existing.id);
          return;
        }
        const status = opts.keepStatus ? rec.status : "draft";
        const { item } = createContent(ctx, { ...rec, status } as ContentInput, actor, opts.origin ?? "import");
        report.created.push(item.id);
      } catch (err) {
        const e = err as ContentError;
        report.errors.push({ index, id: rec.id, message: e.message, issues: e.validation?.errors });
      }
    });
  });
  if (report.created.length || report.updated.length) {
    ctx.audit(actor, "content.import", null, { created: report.created.length, updated: report.updated.length, errors: report.errors.length });
  }
  return report;
}

export function exportContent(ctx: AppContext, type?: ContentType) {
  const rows = ctx.db.all<ContentRow>(`SELECT * FROM content_items ${type ? "WHERE type = ?" : ""} ORDER BY type, id`, type ? [type] : []);
  return rows.map((r) => {
    const item = rowToItem(r);
    return {
      id: item.id,
      type: item.type,
      status: item.status,
      ranked: item.ranked,
      difficulty: item.difficulty,
      tags: item.tags,
      data: item.data,
      verification: item.verification,
    };
  });
}
