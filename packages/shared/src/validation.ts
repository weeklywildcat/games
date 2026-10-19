import {
  contentDataSchemas,
  SOURCE_REQUIRED_CATEGORIES,
  type ConnectionsData,
  type ContentType,
  type MatchData,
  type TriviaData,
  type Verification,
  type WordData,
} from "./content.ts";
import { normalizeTile } from "./connections.ts";
import { isMatchIconKey } from "./icons.ts";
import { findBlockedWords, isBlockedWord } from "./moderation.ts";

/**
 * Content validators. Errors block approval and publishing; warnings are shown
 * to editors as things to double-check (possible ambiguity, style issues).
 */

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult<T = unknown> {
  ok: boolean;
  data?: T;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export interface ValidationContext {
  /** Valid guess dictionary (lowercase). Answers outside it are warned about. */
  dictionary?: ReadonlySet<string>;
  /** Uploaded image ids that exist, for Mini Match themes. */
  imageIds?: ReadonlySet<string>;
  /** Verification metadata, required for school/local trivia. */
  verification?: Verification;
  /** Validate as if publishing (applies verification requirements). */
  forPublish?: boolean;
}

export function validateContent(type: ContentType, raw: unknown, ctx: ValidationContext = {}): ValidationResult {
  const parsed = contentDataSchemas[type].safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => ({ path: i.path.join(".") || "(root)", message: i.message })),
      warnings: [],
    };
  }
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  switch (type) {
    case "word":
      checkWord(parsed.data as WordData, ctx, errors, warnings);
      break;
    case "connections":
      checkConnections(parsed.data as ConnectionsData, errors, warnings);
      break;
    case "trivia":
      checkTrivia(parsed.data as TriviaData, ctx, errors, warnings);
      break;
    case "match":
      checkMatch(parsed.data as MatchData, ctx, errors, warnings);
      break;
  }
  return { ok: errors.length === 0, data: parsed.data, errors, warnings };
}

function checkWord(data: WordData, ctx: ValidationContext, errors: ValidationIssue[], warnings: ValidationIssue[]) {
  if (isBlockedWord(data.answer)) errors.push({ path: "answer", message: "This word is on the moderation blocklist" });
  if (ctx.dictionary && !ctx.dictionary.has(data.answer)) {
    warnings.push({ path: "answer", message: "Not in the guess dictionary; players may find it obscure" });
  }
  if (/(.)\1\1/.test(data.answer)) warnings.push({ path: "answer", message: "Triple letters are unusually hard" });
}

function checkConnections(data: ConnectionsData, errors: ValidationIssue[], warnings: ValidationIssue[]) {
  const seen = new Map<string, number>();
  data.groups.forEach((group, gi) => {
    group.members.forEach((member, mi) => {
      const key = normalizeTile(member);
      const prior = seen.get(key);
      if (prior !== undefined) {
        errors.push({ path: `groups.${gi}.members.${mi}`, message: `"${member}" appears more than once (also in group ${prior + 1})` });
      } else {
        seen.set(key, gi);
      }
      if (key.length > 12) warnings.push({ path: `groups.${gi}.members.${mi}`, message: `"${member}" is long and may wrap on the tile` });
      if (findBlockedWords(member).length) errors.push({ path: `groups.${gi}.members.${mi}`, message: "Contains a blocked word" });
    });
    if (findBlockedWords(group.category).length) errors.push({ path: `groups.${gi}.category`, message: "Contains a blocked word" });
  });

  const categories = data.groups.map((g) => g.category.trim().toLowerCase());
  if (new Set(categories).size !== categories.length) errors.push({ path: "groups", message: "Category names must be different" });

  const levels = data.groups.map((g) => g.level).sort();
  if (levels.join(",") !== "1,2,3,4") {
    errors.push({ path: "groups", message: "Use each difficulty level 1–4 exactly once so the reveal colors are distinct" });
  }

  // Obvious ambiguity: one tile literally containing another, or a tile that is a category name.
  const tiles = [...seen.keys()];
  for (const a of tiles) {
    for (const b of tiles) {
      if (a !== b && a.length >= 3 && b.includes(a) && seen.get(a) !== seen.get(b)) {
        warnings.push({ path: "groups", message: `"${b}" contains "${a}" from another group; check this is intended misdirection` });
      }
    }
    if (categories.includes(a.toLowerCase())) warnings.push({ path: "groups", message: `"${a}" is also a category name` });
  }
  data.groups.forEach((g, gi) => {
    if (!g.explanation) warnings.push({ path: `groups.${gi}.explanation`, message: "Add a short explanation for the reveal" });
  });
}

function checkTrivia(data: TriviaData, ctx: ValidationContext, errors: ValidationIssue[], warnings: ValidationIssue[]) {
  const norm = data.choices.map((c) => c.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
  if (new Set(norm).size !== norm.length) errors.push({ path: "choices", message: "Answer choices must all be different" });
  data.choices.forEach((c, i) => {
    if (/\b(all|none|both) of the above\b/i.test(c)) {
      warnings.push({ path: `choices.${i}`, message: '"Of the above" choices break when answers are shuffled' });
    }
  });
  const blocked = findBlockedWords([data.prompt, ...data.choices, data.explanation ?? ""].join(" "));
  if (blocked.length) errors.push({ path: "prompt", message: "Contains a blocked word" });
  if (!/[?…:]$/.test(data.prompt.trim()) && !data.prompt.includes("_")) {
    warnings.push({ path: "prompt", message: "Questions usually end with a question mark" });
  }
  if (!data.explanation) warnings.push({ path: "explanation", message: "Add a short fact or explanation for the reveal" });

  if (ctx.forPublish && SOURCE_REQUIRED_CATEGORIES.includes(data.category)) {
    const v = ctx.verification;
    if (!v || v.status !== "verified") {
      errors.push({ path: "verification.status", message: "School and local questions must be verified before publishing" });
    }
    if (!v || v.sources.length === 0) {
      errors.push({ path: "verification.sources", message: "Add at least one source for school and local questions" });
    }
  }
}

function checkMatch(data: MatchData, ctx: ValidationContext, errors: ValidationIssue[], warnings: ValidationIssue[]) {
  const ids = new Set<string>();
  const labels = new Set<string>();
  const looks = new Set<string>();
  data.items.forEach((item, i) => {
    if (ids.has(item.id)) errors.push({ path: `items.${i}.id`, message: `Duplicate card id "${item.id}"` });
    ids.add(item.id);
    const label = item.label.toLowerCase();
    if (labels.has(label)) errors.push({ path: `items.${i}.label`, message: `Duplicate label "${item.label}"` });
    labels.add(label);
    if (item.icon && !isMatchIconKey(item.icon)) errors.push({ path: `items.${i}.icon`, message: `Unknown icon "${item.icon}"` });
    if (item.imageId && ctx.imageIds && !ctx.imageIds.has(item.imageId)) {
      errors.push({ path: `items.${i}.imageId`, message: "Image is missing; upload it again" });
    }
    const look = item.icon ?? item.imageId ?? "";
    if (looks.has(look)) errors.push({ path: `items.${i}`, message: "Two cards use the same picture; pairs must look different" });
    looks.add(look);
  });
  const colors = data.items.map((i) => i.color.toLowerCase());
  if (new Set(colors).size < Math.min(colors.length, 6)) {
    warnings.push({ path: "items", message: "Several cards share a color; pictures still differ, but varied colors read faster" });
  }
}
