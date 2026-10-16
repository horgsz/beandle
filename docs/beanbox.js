// Beanbox: seals and opens the puzzle word. Shared by the browser game and scripts/set-word.mjs.
//
// This is obfuscation, not secrecy: the browser must be able to recover the word to score guesses.
// Layers:
//   1. The five letters are each XOR-masked and scattered into 32 random bytes; the slot positions
//      and masks are derived from the puzzle id and key fragment.
//   2. That block is encrypted with AES-256-GCM, authenticated against the puzzle id.
//   3. The AES key is derived with PBKDF2 from three separate inputs: a pepper baked into this file
//      (stored scrambled), a per-puzzle key fragment, and the per-puzzle id. A random salt is also used.
// The decrypted letters live only in short-lived local buffers, which are zeroed after each use.

const VERSION = 1;
const WORD_LENGTH = 5;
const BLOCK_SIZE = 32;
const ITERATIONS = 120000;

const SCRAMBLED = [149, 162, 155, 249, 149, 191, 215, 46, 231, 216, 194, 23, 49, 153, 202, 16, 96, 88, 22, 100, 1, 123, 230, 115, 136, 135, 46, 90, 23, 177, 11, 25];

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

async function deriveKey(id, salt, fragment) {
  const pep = pepper();
  const material = concat(pep, fragment, enc.encode(id));
  pep.fill(0);
  const base = await subtle.importKey("raw", material, "PBKDF2", false, ["deriveKey"]);
  material.fill(0);
  return subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export function isSupported() {
  return !!subtle;
}

/**
 * Create a sealed puzzle object for `word` (5 letters a–z). Used by the build and set-word scripts.
 * `options.id` (16 hex chars) fixes the puzzle id; otherwise a random one is generated.
 */
export async function sealPuzzle(word, options = {}) {
  const w = String(word).toLowerCase();
  if (!/^[a-z]{5}$/.test(w)) throw new Error("Word must be exactly 5 letters A–Z");
  if (options.id !== undefined && !/^[0-9a-f]{16}$/.test(options.id)) throw new Error("Puzzle id must be 16 hex chars");
  const rand = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

  const id = options.id ?? toHex(rand(8));
  const salt = rand(16);
  const fragment = rand(16);
  const iv = rand(12);

  const { slots, masks } = await layout(id, salt, fragment);
  const block = rand(BLOCK_SIZE);
  for (let i = 0; i < WORD_LENGTH; i++) block[slots[i]] = w.charCodeAt(i) ^ masks[i];

  const key = await deriveKey(id, salt, fragment);
  const cipher = await subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(`beandle:${id}`) }, key, block);
  block.fill(0);

  return { v: VERSION, id, s: toHex(salt), k: toHex(fragment), n: toHex(iv), c: toHex(new Uint8Array(cipher)) };
}

/**
 * Prepare a sealed puzzle for play. Returns helpers that decrypt on demand;
 * the word itself is never stored on the returned object.
 */
export async function openPuzzle(puzzle) {
  if (!puzzle || puzzle.v !== VERSION || !/^[0-9a-f]{16}$/.test(puzzle.id)) throw new Error("Bad puzzle data");
  const id = puzzle.id;
  const salt = fromHex(puzzle.s);
  const fragment = fromHex(puzzle.k);
  const iv = fromHex(puzzle.n);
  const cipher = fromHex(puzzle.c);
  const key = await deriveKey(id, salt, fragment);
  const { slots, masks } = await layout(id, salt, fragment);

  async function withLetters(fn) {
    const block = new Uint8Array(
      await subtle.decrypt({ name: "AES-GCM", iv, additionalData: enc.encode(`beandle:${id}`) }, key, cipher),
    );
    const letters = new Uint8Array(WORD_LENGTH);
    for (let i = 0; i < WORD_LENGTH; i++) letters[i] = block[slots[i]] ^ masks[i];
    block.fill(0);
    try {
      return fn(letters);
    } finally {
      letters.fill(0);
    }
  }

  // Verify the puzzle decrypts cleanly up front.
  await withLetters((letters) => {
    if (!letters.every((c) => c >= 97 && c <= 122)) throw new Error("Bad puzzle data");
  });

  return {
    id,
    /** Per-letter result for `guess`: "correct" | "present" | "absent". */
    score: (guess) => withLetters((letters) => {
      const result = Array(WORD_LENGTH).fill("absent");
      const remaining = new Uint8Array(26);
      for (let i = 0; i < WORD_LENGTH; i++) {
        if (guess.charCodeAt(i) === letters[i]) result[i] = "correct";
        else remaining[letters[i] - 97]++;
      }
      for (let i = 0; i < WORD_LENGTH; i++) {
        const c = guess.charCodeAt(i) - 97;
        if (result[i] !== "correct" && remaining[c] > 0) {
          result[i] = "present";
          remaining[c]--;
        }
      }
      remaining.fill(0);
      return result;
    }),
    /** Only call once the game is over. */
    reveal: () => withLetters((letters) => String.fromCharCode(...letters)),
  };
}
