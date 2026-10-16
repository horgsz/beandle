// Beanbox: hides the puzzle word. Shared by the browser game and the build/set-word scripts.
//
// The browser never gets the answer in order to score guesses. Instead each build ships:
//
//   1. A feedback table (puzzle.bin): one 6-byte entry per allowed guess word. The entry's
//      key and a mask byte come from a slow PBKDF2 hash of the guess word (salted per build
//      and per puzzle, plus a pepper baked into this file). The stored byte is that guess's
//      green/yellow/grey pattern XOR the mask. Entries are sorted by key, so the table has no
//      word order and no readable "all green" entry. To score a guess, hash it and look it up;
//      a guess with no entry isn't an allowed word.
//
//   2. A sealed copy of the answer (in puzzle.json), used only to show the answer after a
//      loss. The letters are XOR-masked and scattered among random bytes, encrypted with
//      AES-256-GCM bound to the puzzle id, under a key from a much slower PBKDF2 over split
//      inputs: the pepper, a per-build key fragment, the puzzle id and a digest of the table.
//
// This is still obfuscation, not secrecy: everything needed to play is in the browser.

const VERSION = 2;
const WORD_LENGTH = 5;
const BLOCK_SIZE = 32;
const KEY_BYTES = 5;
const ENTRY_BYTES = KEY_BYTES + 1;
export const GUESS_ITERATIONS = 40000;
const REVEAL_ITERATIONS = 400000;

const SCRAMBLED = [149, 162, 155, 249, 149, 191, 215, 46, 231, 216, 194, 23, 49, 153, 202, 16, 96, 88, 22, 100, 1, 123, 230, 115, 136, 135, 46, 90, 23, 177, 11, 25];
const STATUSES = ["absent", "present", "correct"];

const subtle = globalThis.crypto && globalThis.crypto.subtle;
const enc = new TextEncoder();

function pepper() {
  return Uint8Array.from(SCRAMBLED, (b, i) => b ^ ((i * 167 + 89) & 255));
}

function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex) {
  if (typeof hex !== "string" || !/^([0-9a-f]{2})+$/.test(hex)) throw new Error("Bad puzzle data");
  return Uint8Array.from(hex.match(/../g), (h) => parseInt(h, 16));
}

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.length; }
  return out;
}

async function sha256(...parts) {
  return new Uint8Array(await subtle.digest("SHA-256", concat(...parts)));
}

function compareKey(table, entry, key) {
  const base = entry * ENTRY_BYTES;
  for (let i = 0; i < KEY_BYTES; i++) {
    const d = table[base + i] - key[i];
    if (d) return d;
  }
  return 0;
}

/** Wordle feedback for `guess` against `answer`, as a base-3 code (position 0 = least significant). */
export function feedbackCode(guess, answer) {
  const result = Array(WORD_LENGTH).fill(0);
  const remaining = {};
  for (let i = 0; i < WORD_LENGTH; i++) {
    if (guess[i] === answer[i]) result[i] = 2;
    else remaining[answer[i]] = (remaining[answer[i]] || 0) + 1;
  }
  for (let i = 0; i < WORD_LENGTH; i++) {
    if (result[i] !== 2 && remaining[guess[i]] > 0) {
      result[i] = 1;
      remaining[guess[i]]--;
    }
  }
  return result.reduceRight((code, s) => code * 3 + s, 0);
}

function decodeFeedback(code) {
  const out = [];
  for (let i = 0; i < WORD_LENGTH; i++) { out.push(STATUSES[code % 3]); code = Math.floor(code / 3); }
  return out;
}

/** Slow per-word hash: 5 key bytes + 1 mask byte. */
async function wordHash(word, salt, id, iterations) {
  const pep = pepper();
  const base = await subtle.importKey("raw", enc.encode(word), "PBKDF2", false, ["deriveBits"]);
  const bits = await subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: concat(salt, enc.encode(id), pep), iterations },
    base,
    64,
  );
  pep.fill(0);
  return new Uint8Array(bits);
}

// ---- Sealed answer (only used to reveal after a loss) ---------------------

async function layout(id, salt, fragment) {
  const seed = await sha256(enc.encode(`slots:${id}`), salt, fragment);
  const order = Array.from({ length: BLOCK_SIZE }, (_, i) => i);
  for (let i = BLOCK_SIZE - 1; i > 0; i--) {
    const j = seed[i] % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const masks = await sha256(enc.encode(`mask:${id}`), fragment, salt);
  return { slots: order.slice(0, WORD_LENGTH), masks: masks.slice(0, WORD_LENGTH) };
}

async function revealKey(id, salt, fragment, tableDigest) {
  const pep = pepper();
  const material = concat(pep, fragment, enc.encode(id), tableDigest);
  pep.fill(0);
  const base = await subtle.importKey("raw", material, "PBKDF2", false, ["deriveKey"]);
  material.fill(0);
  return subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: REVEAL_ITERATIONS },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export function isSupported() {
  return !!subtle;
}

/** Hash every allowed word and build the sorted table, or return null on a key collision. */
async function buildTable(words, answer, tableSalt, id, iterations) {
  const entries = new Array(words.length);
  const BATCH = 512;
  for (let start = 0; start < words.length; start += BATCH) {
    const slice = words.slice(start, start + BATCH);
    const hashes = await Promise.all(slice.map((g) => wordHash(g, tableSalt, id, iterations)));
    hashes.forEach((h, j) => {
      const entry = new Uint8Array(ENTRY_BYTES);
      entry.set(h.subarray(0, KEY_BYTES));
      entry[KEY_BYTES] = feedbackCode(slice[j], answer) ^ h[KEY_BYTES];
      entries[start + j] = entry;
    });
  }
  entries.sort((a, b) => {
    for (let i = 0; i < KEY_BYTES; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
  });
  for (let i = 1; i < entries.length; i++) {
    let same = true;
    for (let k = 0; k < KEY_BYTES && same; k++) same = entries[i][k] === entries[i - 1][k];
    if (same) return null;
  }
  return concat(...entries);
}

/**
 * Build a puzzle for `answer`. `guessWords` is the allowed-guess list (the answer is always
 * added). `options.id` (16 hex chars) fixes the puzzle id; otherwise it's random.
 * Returns { meta, table }: meta is JSON-safe (puzzle.json), table is bytes (puzzle.bin).
 */
export async function sealPuzzle(answer, guessWords, options = {}) {
  const w = String(answer).toLowerCase();
  if (!/^[a-z]{5}$/.test(w)) throw new Error("Word must be exactly 5 letters A–Z");
  if (options.id !== undefined && !/^[0-9a-f]{16}$/.test(options.id)) throw new Error("Puzzle id must be 16 hex chars");
  const iterations = options.iterations ?? GUESS_ITERATIONS;
  const rand = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
  const id = options.id ?? toHex(rand(8));

  // Feedback table. Retries with a fresh salt in the (very unlikely) event of a key collision.
  const words = [...new Set([...guessWords.map((g) => String(g).toLowerCase()), w])].filter((g) => /^[a-z]{5}$/.test(g));
  let table = null;
  let tableSalt = null;
  for (let attempt = 0; attempt < 5 && !table; attempt++) {
    tableSalt = rand(16);
    table = await buildTable(words, w, tableSalt, id, iterations);
  }
  if (!table) throw new Error("Could not build feedback table");

  // Sealed answer for the loss reveal.
  const salt = rand(16);
  const fragment = rand(16);
  const iv = rand(12);
  const { slots, masks } = await layout(id, salt, fragment);
  const block = rand(BLOCK_SIZE);
  for (let i = 0; i < WORD_LENGTH; i++) block[slots[i]] = w.charCodeAt(i) ^ masks[i];
  const tableDigest = await sha256(table);
  const key = await revealKey(id, salt, fragment, tableDigest);
  const cipher = await subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(`beandle:${id}`) }, key, block);
  block.fill(0);

  const meta = {
    v: VERSION,
    id,
    h: toHex(tableDigest.subarray(0, 8)),
    n: iterations,
    t: toHex(tableSalt),
    s: toHex(salt),
    k: toHex(fragment),
    i: toHex(iv),
    c: toHex(new Uint8Array(cipher)),
  };
  if (Number.isInteger(options.day)) meta.d = options.day;
  if (options.fact) {
    // The day's bean fact, locked with a key derived from the answer itself, so it can
    // only be read once the player knows the word (a win, or the loss reveal).
    const factSalt = rand(16);
    const factIv = rand(12);
    const factKey = await factKeyFor(w, factSalt, id, iterations);
    const sealed = await subtle.encrypt({ name: "AES-GCM", iv: factIv }, factKey, enc.encode(String(options.fact)));
    meta.fs = toHex(factSalt);
    meta.fi = toHex(factIv);
    meta.f = toHex(new Uint8Array(sealed));
  }
  return { meta, table };
}

async function factKeyFor(word, factSalt, id, iterations) {
  const pep = pepper();
  const base = await subtle.importKey("raw", enc.encode(`fact:${word}`), "PBKDF2", false, ["deriveKey"]);
  const key = await subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: concat(factSalt, enc.encode(id), pep), iterations },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  pep.fill(0);
  return key;
}

/**
 * Prepare a puzzle for play. The returned object can score guesses (via the table) and,
 * after a loss, reveal the answer. It never holds the answer itself.
 */
export async function openPuzzle(meta, tableBytes) {
  if (!meta || meta.v !== VERSION || !/^[0-9a-f]{16}$/.test(meta.id)) throw new Error("Bad puzzle data");
  const table = tableBytes instanceof Uint8Array ? tableBytes : new Uint8Array(tableBytes);
  if (!table.length || table.length % ENTRY_BYTES) throw new Error("Bad puzzle data");
  const id = meta.id;
  const iterations = Number(meta.n);
  if (!Number.isInteger(iterations) || iterations < 1000) throw new Error("Bad puzzle data");
  const tableSalt = fromHex(meta.t);
  const count = table.length / ENTRY_BYTES;

  return {
    id,
    /** Per-letter result for `guess`, or null if it isn't an allowed word. */
    async score(guess) {
      if (!/^[a-z]{5}$/.test(guess)) return null;
      const h = await wordHash(guess, tableSalt, id, iterations);
      let lo = 0;
      let hi = count - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const cmp = compareKey(table, mid, h);
        if (cmp === 0) {
          const code = table[mid * ENTRY_BYTES + KEY_BYTES] ^ h[KEY_BYTES];
          h.fill(0);
          return code < 243 ? decodeFeedback(code) : null;
        }
        if (cmp < 0) lo = mid + 1;
        else hi = mid - 1;
      }
      h.fill(0);
      return null;
    },
    /** 1-based event day, if the build stamped one. */
    day: Number.isInteger(meta.d) ? meta.d : null,
    /** The day's bean fact, given the answer (known after a win or the loss reveal). */
    async fact(word) {
      if (!meta.f || !/^[a-z]{5}$/.test(word)) return null;
      try {
        const key = await factKeyFor(word, fromHex(meta.fs), id, iterations);
        const plain = await subtle.decrypt({ name: "AES-GCM", iv: fromHex(meta.fi) }, key, fromHex(meta.f));
        return new TextDecoder().decode(plain);
      } catch {
        return null;
      }
    },
    /** Only call once the game is lost. Deliberately slow. */
    async reveal() {
      const salt = fromHex(meta.s);
      const fragment = fromHex(meta.k);
      const key = await revealKey(id, salt, fragment, await sha256(table));
      const block = new Uint8Array(
        await subtle.decrypt({ name: "AES-GCM", iv: fromHex(meta.i), additionalData: enc.encode(`beandle:${id}`) }, key, fromHex(meta.c)),
      );
      const { slots, masks } = await layout(id, salt, fragment);
      const letters = new Uint8Array(WORD_LENGTH);
      for (let i = 0; i < WORD_LENGTH; i++) letters[i] = block[slots[i]] ^ masks[i];
      block.fill(0);
      const word = String.fromCharCode(...letters);
      letters.fill(0);
      if (!/^[a-z]{5}$/.test(word)) throw new Error("Bad puzzle data");
      return word;
    },
  };
}