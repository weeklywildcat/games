import { describe, expect, it } from "vitest";
import { checkSelection, scoreConnections, selectionKey, shuffledTiles } from "../src/connections.ts";
import type { ConnectionsData } from "../src/content.ts";

const puzzle: ConnectionsData = {
  groups: [
    { level: 1, category: "Reds", members: ["Crimson", "Scarlet", "Ruby", "Cherry"] },
    { level: 2, category: "Trees", members: ["Oak", "Aspen", "Birch", "Willow"] },
    { level: 3, category: "Keys", members: ["Piano", "Map", "Lock", "Florida"] },
    { level: 4, category: "Hidden body parts", members: ["China", "Shiny", "Pearl", "Ships"] },
  ],
};

describe("checkSelection", () => {
  it("finds a correct group regardless of order and case", () => {
    expect(checkSelection(puzzle, [], [], ["willow", "OAK", "Birch", "aspen"])).toEqual({ kind: "correct", groupIndex: 1 });
  });

  it("reports one away when exactly three belong together", () => {
    expect(checkSelection(puzzle, [], [], ["OAK", "ASPEN", "BIRCH", "RUBY"])).toEqual({ kind: "incorrect", oneAway: true });
    expect(checkSelection(puzzle, [], [], ["OAK", "ASPEN", "RUBY", "MAP"])).toEqual({ kind: "incorrect", oneAway: false });
  });

  it("treats a repeated wrong guess as a duplicate, not a mistake", () => {
    const prior = [selectionKey(["OAK", "ASPEN", "BIRCH", "RUBY"])];
    expect(checkSelection(puzzle, [], prior, ["RUBY", "BIRCH", "ASPEN", "OAK"])).toEqual({ kind: "duplicate" });
  });

  it("rejects malformed selections", () => {
    expect(checkSelection(puzzle, [], [], ["OAK", "ASPEN", "BIRCH"]).kind).toBe("invalid");
    expect(checkSelection(puzzle, [], [], ["OAK", "OAK", "BIRCH", "ASPEN"]).kind).toBe("invalid");
    expect(checkSelection(puzzle, [], [], ["OAK", "ASPEN", "BIRCH", "ZEBRA"]).kind).toBe("invalid");
    expect(checkSelection(puzzle, [1], [], ["OAK", "ASPEN", "BIRCH", "WILLOW"]).kind).toBe("invalid");
  });

  it("ignores solved groups when looking for one-away", () => {
    expect(checkSelection(puzzle, [1], [], ["PIANO", "MAP", "LOCK", "RUBY"])).toEqual({ kind: "incorrect", oneAway: true });
  });
});

describe("scoring and layout", () => {
  it("scores wins by mistakes and losses by groups found", () => {
    expect(scoreConnections({ won: true, mistakes: 0, solvedGroups: 4 })).toBe(1000);
    expect(scoreConnections({ won: true, mistakes: 3, solvedGroups: 4 })).toBe(700);
    expect(scoreConnections({ won: false, mistakes: 4, solvedGroups: 2 })).toBe(300);
  });

  it("shuffles deterministically by seed and keeps every tile", () => {
    const a = shuffledTiles(puzzle, 42);
    expect(shuffledTiles(puzzle, 42)).toEqual(a);
    expect([...a].sort()).toEqual(puzzle.groups.flatMap((g) => g.members.map((m) => m.toUpperCase())).sort());
  });
});
