import { isIP } from "node:net";

/** CIDR allowlist matching for the admin surface (IPv4, IPv6, and IPv4-mapped IPv6). */

function ipv4ToBigInt(ip: string): bigint {
  return ip.split(".").reduce((acc, part) => (acc << 8n) + BigInt(Number(part)), 0n);
}

function ipv6ToBigInt(ip: string): bigint {
  let [head, tail] = ip.split("::") as [string, string | undefined];
  const parse = (s: string) => (s ? s.split(":") : []);
  let headParts = parse(head);
  let tailParts = tail === undefined ? [] : parse(tail);
  // Embedded IPv4 at the end (e.g. ::ffff:10.0.0.1).
  const last = (tail === undefined ? headParts : tailParts).at(-1);
  if (last && last.includes(".")) {
    const v4 = ipv4ToBigInt(last);
    const extra = [((v4 >> 16n) & 0xffffn).toString(16), (v4 & 0xffffn).toString(16)];
    if (tail === undefined) headParts = [...headParts.slice(0, -1), ...extra];
    else tailParts = [...tailParts.slice(0, -1), ...extra];
  }
  const missing = 8 - headParts.length - tailParts.length;
  const parts = tail === undefined ? headParts : [...headParts, ...new Array(missing).fill("0"), ...tailParts];
  return parts.reduce((acc, p) => (acc << 16n) + BigInt(parseInt(p || "0", 16)), 0n);
}

function normalize(ip: string): { v: 4 | 6; n: bigint } | null {
  const clean = ip.replace(/^\[|\]$/g, "").split("%")[0];
  const kind = isIP(clean);
  if (kind === 4) return { v: 4, n: ipv4ToBigInt(clean) };
  if (kind === 6) {
    const lower = clean.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return { v: 4, n: ipv4ToBigInt(mapped[1]) };
    return { v: 6, n: ipv6ToBigInt(lower) };
  }
  return null;
}

export function ipInCidr(ip: string, cidr: string): boolean {
  const [base, bitsRaw] = cidr.split("/");
  const addr = normalize(ip);
  const net = normalize(base);
  if (!addr || !net || addr.v !== net.v) return false;
  const width = addr.v === 4 ? 32 : 128;
  const bits = bitsRaw === undefined ? width : Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > width) return false;
  if (bits === 0) return true;
  const shift = BigInt(width - bits);
  return addr.n >> shift === net.n >> shift;
}

export function ipAllowed(ip: string | undefined, cidrs: string[]): boolean {
  if (!ip) return false;
  return cidrs.some((c) => ipInCidr(ip, c));
}

export function isLoopback(ip: string | undefined): boolean {
  return ipAllowed(ip, ["127.0.0.0/8", "::1/128"]);
}
