/**
 * Tiny synthesized sound cues (no audio files). Muted unless an admin turns
 * sound on, and never played without a touch first.
 */

let ctx: AudioContext | null = null;
let enabled = false;

export function setSoundEnabled(on: boolean) {
  enabled = on;
}

function audio(): AudioContext | null {
  if (!enabled) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, start: number, length: number, type: OscillatorType = "sine", gain = 0.08) {
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime + start;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + length);
  osc.connect(g).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + length + 0.02);
}

export const sfx = {
  tap: () => tone(660, 0, 0.06, "triangle", 0.04),
  good: () => {
    tone(660, 0, 0.12, "triangle");
    tone(990, 0.08, 0.16, "triangle");
  },
  bad: () => tone(220, 0, 0.18, "sine", 0.06),
  win: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, i * 0.09, 0.22, "triangle")),
};
