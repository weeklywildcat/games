export * from "./api.ts";
export * from "./connections.ts";
export * from "./content.ts";
export * from "./icons.ts";
export * from "./match.ts";
export * from "./moderation.ts";
export * from "./nicknames.ts";
export * from "./rng.ts";
export * from "./rush.ts";
export * from "./settings.ts";
export * from "./time.ts";
export * from "./trivia.ts";
export * from "./validation.ts";
export * from "./word.ts";

export const GAME_META = {
  word: { name: "Wildcat Word", short: "Word", blurb: "Guess the five-letter word in six tries." },
  connections: { name: "Connections", short: "Connections", blurb: "Sort sixteen words into four secret groups." },
  trivia: { name: "Trivia Blitz", short: "Trivia", blurb: "Ten questions. One clock. Build a streak." },
  match: { name: "Mini Match", short: "Match", blurb: "Flip cards and find all six pairs." },
  rush: { name: "Wildcat Rush", short: "Rush", blurb: "Ninety seconds of everything, fast." },
} as const;
