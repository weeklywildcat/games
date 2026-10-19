import { z } from "zod";

/**
 * Content schemas. Every puzzle, question, and theme is a `content_items` row whose
 * `data` column matches one of these shapes. The same schemas validate admin edits,
 * imports, and the seed bank.
 */

export const GAME_IDS = ["word", "connections", "trivia", "match", "rush"] as const;
export type GameId = (typeof GAME_IDS)[number];
export const CORE_GAMES = ["word", "connections", "trivia", "match"] as const satisfies readonly GameId[];

export const CONTENT_TYPES = ["word", "connections", "trivia", "match"] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

/**
 * Workflow: draft → review → approved → published. Archived items are kept for
 * history but never served. Only published items reach players; ranked play
 * additionally requires `ranked: true`.
 */
export const CONTENT_STATUSES = ["draft", "review", "approved", "published", "archived"] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

export const VERIFICATION_STATUSES = ["unverified", "needs_source", "verified"] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const verificationSchema = z.object({
  status: z.enum(VERIFICATION_STATUSES).default("unverified"),
  sources: z.array(z.string().trim().min(1).max(500)).max(10).default([]),
  notes: z.string().max(2000).default(""),
  verifiedBy: z.string().max(80).optional(),
  verifiedAt: z.string().max(40).optional(),
});
export type Verification = z.infer<typeof verificationSchema>;

// --- Word ---------------------------------------------------------------

export const wordDataSchema = z.object({
  answer: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z]{5}$/, "Answers must be exactly five letters A–Z"),
});
export type WordData = z.infer<typeof wordDataSchema>;

// --- Connections ----------------------------------------------------------

export const connectionsGroupSchema = z.object({
  category: z.string().trim().min(2).max(60),
  members: z.array(z.string().trim().min(1).max(16)).length(4),
  /** 1 = most straightforward … 4 = trickiest. Drives the reveal color. */
  level: z.number().int().min(1).max(4),
  explanation: z.string().trim().max(200).optional(),
});
export type ConnectionsGroup = z.infer<typeof connectionsGroupSchema>;

export const connectionsDataSchema = z.object({
  title: z.string().trim().max(60).optional(),
  groups: z.array(connectionsGroupSchema).length(4),
});
export type ConnectionsData = z.infer<typeof connectionsDataSchema>;

// --- Trivia ---------------------------------------------------------------

export const TRIVIA_CATEGORIES = [
  "nshs-history",
  "nshs-traditions",
  "nshs-athletics",
  "nshs-clubs",
  "nshs-people",
  "ninety-six-greenwood",
  "south-carolina",
  "pop-culture",
  "general",
  "science",
  "geography",
  "history",
  "words-language",
  "sports",
  "news-journalism",
  "weekly-wildcat",
] as const;
export type TriviaCategory = (typeof TRIVIA_CATEGORIES)[number];

export const TRIVIA_CATEGORY_LABELS: Record<TriviaCategory, string> = {
  "nshs-history": "NSHS History",
  "nshs-traditions": "School Traditions",
  "nshs-athletics": "Wildcat Athletics",
  "nshs-clubs": "Clubs & Activities",
  "nshs-people": "Teachers & Staff",
  "ninety-six-greenwood": "Ninety Six & Greenwood",
  "south-carolina": "South Carolina",
  "pop-culture": "Pop Culture",
  general: "General Knowledge",
  science: "Science",
  geography: "Geography",
  history: "History",
  "words-language": "Words & Language",
  sports: "Sports",
  "news-journalism": "News & Journalism",
  "weekly-wildcat": "Weekly Wildcat",
};

/** School and local categories always need a verified source before publishing. */
export const SOURCE_REQUIRED_CATEGORIES: readonly TriviaCategory[] = [
  "nshs-history",
  "nshs-traditions",
  "nshs-athletics",
  "nshs-clubs",
  "nshs-people",
  "ninety-six-greenwood",
  "weekly-wildcat",
];

export const triviaDataSchema = z.object({
  prompt: z.string().trim().min(8).max(180),
  choices: z.array(z.string().trim().min(1).max(64)).length(4),
  answerIndex: z.number().int().min(0).max(3),
  explanation: z.string().trim().max(240).optional(),
  category: z.enum(TRIVIA_CATEGORIES),
});
export type TriviaData = z.infer<typeof triviaDataSchema>;

// --- Mini Match -------------------------------------------------------------

export const matchItemSchema = z
  .object({
    id: z.string().trim().regex(/^[a-z0-9-]{1,40}$/),
    label: z.string().trim().min(1).max(32),
    /** A key from MATCH_ICON_KEYS, or omit and provide imageId. */
    icon: z.string().trim().max(40).optional(),
    /** An uploaded image (admin uploads), referenced by id. */
    imageId: z.string().trim().max(64).optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  })
  .refine((v) => Boolean(v.icon) !== Boolean(v.imageId), {
    message: "Each card needs exactly one of an icon or an uploaded image",
  });
export type MatchItem = z.infer<typeof matchItemSchema>;

export const matchDataSchema = z.object({
  name: z.string().trim().min(2).max(40),
  description: z.string().trim().max(120).optional(),
  /** Card-back pattern so themes look distinct before anything flips. */
  back: z.enum(["dots", "stripes", "grid", "waves", "checks"]).default("dots"),
  items: z.array(matchItemSchema).min(6).max(12),
});
export type MatchData = z.infer<typeof matchDataSchema>;

export const contentDataSchemas = {
  word: wordDataSchema,
  connections: connectionsDataSchema,
  trivia: triviaDataSchema,
  match: matchDataSchema,
} as const;

export type ContentDataByType = {
  word: WordData;
  connections: ConnectionsData;
  trivia: TriviaData;
  match: MatchData;
};

/** Shape used by imports, exports, and the seed bank. */
export const contentRecordSchema = z.object({
  id: z.string().trim().max(80).optional(),
  type: z.enum(CONTENT_TYPES),
  status: z.enum(CONTENT_STATUSES).default("draft"),
  ranked: z.boolean().default(false),
  difficulty: z.number().int().min(1).max(5).default(2),
  tags: z.array(z.string().trim().max(40)).max(12).default([]),
  data: z.unknown(),
  verification: verificationSchema.default({ status: "unverified", sources: [], notes: "" }),
});
export type ContentRecordInput = z.input<typeof contentRecordSchema>;

export interface ContentItem<T extends ContentType = ContentType> {
  id: string;
  type: T;
  status: ContentStatus;
  ranked: boolean;
  difficulty: number;
  tags: string[];
  data: ContentDataByType[T];
  verification: Verification;
  createdAt: string;
  updatedAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  timesServed: number;
  lastServedAt: string | null;
}
