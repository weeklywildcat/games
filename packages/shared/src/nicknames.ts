import { createRng, pick, type Rng } from "./rng.ts";

/**
 * Leaderboard names are generated, never typed. Players choose from a few
 * suggestions, so nothing inappropriate can reach the public screen and no
 * real names are collected. Both lists are deliberately bland and positive.
 */

export const NICKNAME_ADJECTIVES = [
  "Bold", "Brave", "Bright", "Brisk", "Calm", "Clever", "Cosmic", "Crisp", "Daring", "Dapper",
  "Eager", "Electric", "Epic", "Fearless", "Fierce", "Fleet", "Fresh", "Gentle", "Golden", "Grand",
  "Happy", "Heroic", "Jolly", "Keen", "Kind", "Lively", "Lucky", "Lunar", "Mellow", "Mighty",
  "Nimble", "Noble", "Plucky", "Polar", "Proud", "Quick", "Quiet", "Radiant", "Rapid", "Royal",
  "Rustic", "Sharp", "Shiny", "Silver", "Sly", "Snappy", "Solar", "Sonic", "Speedy", "Steady",
  "Stellar", "Sunny", "Super", "Swift", "Tidy", "Turbo", "Vivid", "Wise", "Witty", "Zesty",
] as const;

export const NICKNAME_NOUNS = [
  "Badger", "Bison", "Bobcat", "Comet", "Condor", "Cougar", "Coyote", "Crane", "Falcon", "Ferret",
  "Finch", "Fox", "Gecko", "Hawk", "Heron", "Ibis", "Jaguar", "Koala", "Lynx", "Marlin",
  "Meteor", "Moose", "Narwhal", "Nebula", "Ocelot", "Orca", "Osprey", "Otter", "Owl", "Panda",
  "Panther", "Pelican", "Penguin", "Puffin", "Quasar", "Raccoon", "Raven", "Rocket", "Sparrow", "Squid",
  "Stingray", "Tiger", "Toucan", "Walrus", "Wildcat", "Wolf", "Wombat", "Yak", "Zebra", "Puma",
] as const;

const NICKNAME_PATTERN = /^([A-Z][a-z]+) ([A-Z][a-z]+) (\d{2})$/;

export function generateNickname(rng: Rng): string {
  const number = 10 + Math.floor(rng() * 90);
  return `${pick(NICKNAME_ADJECTIVES, rng)} ${pick(NICKNAME_NOUNS, rng)} ${number}`;
}

export function suggestNicknames(count: number, seed = Date.now()): string[] {
  const rng = createRng(seed);
  const out = new Set<string>();
  while (out.size < count) out.add(generateNickname(rng));
  return [...out];
}

/** Server-side gate: a submitted name must be one this generator could produce. */
export function isValidNickname(name: string): boolean {
  const m = NICKNAME_PATTERN.exec(name);
  if (!m) return false;
  return (
    (NICKNAME_ADJECTIVES as readonly string[]).includes(m[1]) &&
    (NICKNAME_NOUNS as readonly string[]).includes(m[2]) &&
    Number(m[3]) >= 10 &&
    Number(m[3]) <= 99
  );
}
