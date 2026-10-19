import { z } from "zod";
import { GAME_IDS } from "./content.ts";
import { isIsoDay, parseClock } from "./time.ts";

/**
 * Kiosk settings. Stored as one JSON document; admins edit them live and the
 * board picks up changes over Server-Sent Events.
 */

const clock = z.string().refine((v) => {
  try {
    parseClock(v);
    return true;
  } catch {
    return false;
  }
}, "Use 24-hour HH:MM");

const isoDay = z.string().refine(isIsoDay, "Use YYYY-MM-DD");

export const ANIMATION_LEVELS = ["full", "reduced", "minimal"] as const;
export type AnimationLevel = (typeof ANIMATION_LEVELS)[number];

const gameToggle = z.object({ enabled: z.boolean() });

export const settingsSchema = z
  .object({
    timezone: z.string().min(1).max(64),
    branding: z.object({
      publicationName: z.string().trim().min(1).max(60),
      schoolName: z.string().trim().max(80),
      /** Path or URL of the wordmark; uploaded logos live under /uploads. */
      logoUrl: z.string().trim().max(300),
    }),
    attract: z.object({
      mode: z.enum(["animated", "static"]),
      /** Optional lines shown under the title on the welcome scene. Empty by default. */
      headlines: z.array(z.string().trim().min(2).max(48)).max(12),
      sceneSeconds: z.number().int().min(8).max(60),
      featuredGame: z.enum(GAME_IDS).nullable(),
    }),
    games: z.object(Object.fromEntries(GAME_IDS.map((g) => [g, gameToggle])) as Record<(typeof GAME_IDS)[number], typeof gameToggle>),
    idle: z
      .object({
        timeoutSeconds: z.number().int().min(30).max(1800),
        warningSeconds: z.number().int().min(5).max(120),
      })
      .refine((v) => v.warningSeconds < v.timeoutSeconds, "The warning must be shorter than the timeout"),
    animation: z.object({ level: z.enum(ANIMATION_LEVELS) }),
    sound: z.object({ enabled: z.boolean() }),
    trivia: z.object({
      roundSeconds: z.number().int().min(30).max(300),
    }),
    rush: z.object({ seconds: z.number().int().min(30).max(300) }),
    challenge: z
      .object({
        enabled: z.boolean(),
        title: z.string().trim().min(3).max(80),
        target: z.number().int().min(1).max(1_000_000),
        start: isoDay,
        end: isoDay,
      })
      .refine((v) => v.start <= v.end, "The challenge must end on or after its start"),
    event: z
      .object({
        name: z.string().trim().min(2).max(40),
        start: isoDay,
        end: isoDay,
      })
      .refine((v) => v.start <= v.end, "The event must end on or after its start"),
    quietHours: z.object({
      enabled: z.boolean(),
      /** static: calm poster, touch still plays. closed: no play, message only. */
      mode: z.enum(["static", "closed"]),
      message: z.string().trim().max(120),
      windows: z
        .array(
          z.object({
            days: z.array(z.number().int().min(0).max(6)).min(1),
            start: clock,
            end: clock,
          }),
        )
        .max(14),
    }),
    kiosk: z.object({
      paused: z.boolean(),
      pauseMessage: z.string().trim().max(120),
    }),
    privacy: z.object({
      /** Game sessions and events older than this are purged nightly. Leaderboard entries are kept. */
      retentionDays: z.number().int().min(7).max(3650),
    }),
  })
  .strict();

export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  timezone: "America/New_York",
  branding: {
    publicationName: "The Weekly Wildcat",
    schoolName: "Ninety Six High School",
    logoUrl: "/brand/weekly-wildcat-wide-logo.svg",
  },
  attract: {
    mode: "animated",
    headlines: [],
    sceneSeconds: 18,
    featuredGame: null,
  },
  games: {
    word: { enabled: true },
    connections: { enabled: true },
    trivia: { enabled: true },
    match: { enabled: true },
    // Hidden for launch; staff can turn it on from Kiosk control.
    rush: { enabled: false },
  },
  idle: { timeoutSeconds: 120, warningSeconds: 20 },
  animation: { level: "full" },
  sound: { enabled: false },
  trivia: { roundSeconds: 75 },
  rush: { seconds: 90 },
  challenge: {
    enabled: false,
    title: "Can we solve 1,000 puzzles by Friday?",
    target: 1000,
    start: "2026-10-26",
    end: "2026-10-30",
  },
  event: { name: "Launch Week", start: "2026-10-26", end: "2026-10-30" },
  quietHours: {
    enabled: false,
    mode: "static",
    message: "Wildcat Games is resting. See you tomorrow.",
    windows: [{ days: [1, 2, 3, 4, 5], start: "16:30", end: "07:00" }],
  },
  kiosk: { paused: false, pauseMessage: "Back in a moment." },
  privacy: { retentionDays: 180 },
};

/** Settings the public kiosk receives. Everything here is safe to show on the board. */
export type KioskConfig = Pick<
  Settings,
  "timezone" | "branding" | "attract" | "games" | "idle" | "animation" | "sound" | "trivia" | "rush" | "challenge" | "event" | "kiosk"
> & {
  quiet: { active: boolean; mode: "static" | "closed"; message: string };
  version: string;
  day: string;
};
