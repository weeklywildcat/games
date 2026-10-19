/**
 * A small blocklist used to keep offensive words off the public screen: they are
 * rejected as Word guesses and flagged in authored content. Entries are ROT13
 * encoded so the list itself isn't offensive to read in the source tree.
 *
 * `roots` match anywhere inside a word; `exact` match whole words only (so
 * "canal" and "peacock" are fine).
 */
const ENCODED = {
  roots: ["shpx", "fuvg", "phag", "avtt", "sntt", "xvxr", "juber", "fyhg", "ovgpu", "qvyqb", "cbea", "cravf", "chffl", "frk", "anmv", "gjng", "jnax", "wvmm"],
  exact: [
    "phz", "snt", "sntf", "qvpx", "qvpxf", "pbpx", "pbpxf", "pbpxl", "gvgf", "gvggl", "gvggvrf", "obbo", "obbof", "obbol",
    "nany", "nahf", "encr", "encrq", "encrf", "encvfg", "qlxr", "qlxrf", "ubzb", "ubzbf", "dhrre", "fcvp", "fcvpf",
    "puvax", "tbbx", "tbbxf", "ergneq", "ergneqf", "cevpx", "cevpxf", "cvff", "cvffl", "cvffrq", "ubeal", "frzra",
    "obare", "obaref", "fxnax", "fxnaxf", "ubbxre", "genaal", "yrfob", "nefr", "nefrf", "nffrf", "onfgneq", "crpxre",
    "uvgyre", "ahqr", "ahqrf", "ahqvr", "fynt", "fyntf", "obat", "obatf", "intvan", "cvzc", "cvzcf",
  ],
};

const rot13 = (s: string) => s.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));

const ROOTS = ENCODED.roots.map(rot13);
const EXACT = new Set(ENCODED.exact.map(rot13));

export function isBlockedWord(word: string): boolean {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return false;
  return EXACT.has(w) || ROOTS.some((root) => w.includes(root));
}

/** Returns the offending words found in free text (for content validation warnings). */
export function findBlockedWords(text: string): string[] {
  return [...new Set(text.toLowerCase().split(/[^a-z]+/).filter((w) => w && isBlockedWord(w)))];
}
