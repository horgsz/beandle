import { test } from "node:test";
import assert from "node:assert/strict";
import { sealPuzzle, openPuzzle } from "../docs/beanbox.js";
import { VALID_GUESSES } from "../docs/words.js";

const WORD = "crane";

test("sealed puzzle never contains the word in plain or simple encodings", async () => {
  const puzzle = await sealPuzzle(WORD);
  const json = JSON.stringify(puzzle).toLowerCase();
  const encodings = [
    WORD,
    Buffer.from(WORD).toString("hex"),
    Buffer.from(WORD).toString("base64").toLowerCase(),
    WORD.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97)),
    [...WORD].reverse().join(""),
  ];
  for (const e of encodings) assert.ok(!json.includes(e), `found ${e}`);
  assert.match(puzzle.id, /^[0-9a-f]{16}$/);
});

test("each seal gets a fresh random id, key fragment and ciphertext", async () => {
  const a = await sealPuzzle(WORD);
  const b = await sealPuzzle(WORD);
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.k, b.k);
  assert.notEqual(a.c, b.c);
});

test("opened puzzle scores guesses and reveals the word", async () => {
  const p = await openPuzzle(await sealPuzzle(WORD));
  assert.deepEqual(await p.score("crane"), ["correct", "correct", "correct", "correct", "correct"]);
  assert.deepEqual(await p.score("acram"), ["present", "present", "present", "absent", "absent"]);
  assert.equal(await p.reveal(), WORD);
  assert.ok(!JSON.stringify(Object.keys(p)).includes(WORD));
});

test("duplicate letters are scored like Wordle", async () => {
  const p = await openPuzzle(await sealPuzzle("hello"));
  assert.deepEqual(await p.score("lolly"), ["absent", "present", "correct", "correct", "absent"]);
  const q = await openPuzzle(await sealPuzzle("tetes"));
  assert.deepEqual(await q.score("tstse"), ["correct", "present", "correct", "absent", "present"]);
});

test("tampered puzzles are rejected", async () => {
  const puzzle = await sealPuzzle(WORD);
  await assert.rejects(openPuzzle({ ...puzzle, id: "0123456789abcdef" }));
  const flipped = puzzle.c.slice(0, -2) + (puzzle.c.endsWith("00") ? "01" : "00");
  await assert.rejects(openPuzzle({ ...puzzle, c: flipped }));
});

test("sealPuzzle validates input", async () => {
  await assert.rejects(sealPuzzle("bean"));
  await assert.rejects(sealPuzzle("be4ns"));
});

test("a fixed puzzle id is honoured and validated", async () => {
  const p = await sealPuzzle(WORD, { id: "00112233aabbccdd" });
  assert.equal(p.id, "00112233aabbccdd");
  assert.equal((await openPuzzle(p)).id, "00112233aabbccdd");
  await assert.rejects(sealPuzzle(WORD, { id: "xyz" }));
});

test("guess list is five-letter lowercase words", () => {
  assert.ok(VALID_GUESSES.length > 2000);
  assert.ok(VALID_GUESSES.every((w) => /^[a-z]{5}$/.test(w)));
});
