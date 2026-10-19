import { describe, expect, it } from "vitest";
import { idlePhase, secondsUntilReset } from "./idle.ts";

describe("inactivity phases", () => {
  const timeout = 120_000;
  const warning = 20_000;

  it("moves from active to warning to expired", () => {
    expect(idlePhase(0, 0, timeout, warning)).toBe("active");
    expect(idlePhase(0, 99_999, timeout, warning)).toBe("active");
    expect(idlePhase(0, 100_000, timeout, warning)).toBe("warning");
    expect(idlePhase(0, 119_999, timeout, warning)).toBe("warning");
    expect(idlePhase(0, 120_000, timeout, warning)).toBe("expired");
  });

  it("restarts from the latest activity", () => {
    expect(idlePhase(110_000, 130_000, timeout, warning)).toBe("active");
  });

  it("counts down whole seconds during the warning", () => {
    expect(secondsUntilReset(0, 100_000, timeout)).toBe(20);
    expect(secondsUntilReset(0, 119_100, timeout)).toBe(1);
    expect(secondsUntilReset(0, 125_000, timeout)).toBe(0);
  });
});
