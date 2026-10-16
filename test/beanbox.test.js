import { test } from "node:test";
import assert from "node:assert/strict";
import { sealPuzzle, openPuzzle, feedbackCode } from "../docs/beanbox.js";
import { VALID_GUESSES } from "../docs/words.js";

const WORD = "crane";
const GUESSES = ["crane", "react", "trace", "hello", "lolly", "plumb", "acorn", "nacre", "caner", "about"];
const FAST = { iterations: 1000 };
const seal = (word = WORD, words = GUESSES, opts = {}) => sealPuzzle(word, words, { ...FAST, ...opts });

function encodings(word) {
  return [
    word,
    Buffer.from(word).toString("hex"),
    Buffer.from(word).toString("base64").toLowerCase(),
    word.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97)),
    [...word].reverse().join(""),
  ];
}

test("neither puzzle.json nor the table contains the word in plain or simple encodings", async () => {
  const { meta, table } = await seal();
  const json = JSON.stringify(meta).toLowerCase();
  const bin = Buffer.from(table);
  for (const e of encodings(WORD)) {
    assert.ok(!json.includes(e), `json has ${e}`);
    assert.ok(!bin.toString("latin1").toLowerCase().includes(e), `table has ${e}`);
    assert.ok(!bin.toString("hex").includes(e), `table hex has ${e}`);
  }
  assert.match(meta.id, /^[0-9a-f]{16}$/);
});

test("the table has one sorted 6-byte entry per allowed word plus the answer", async () => {
  const { table } = await seal("pinto");
  assert.equal(table.length, (GUESSES.length + 1) * 6);
  for (let i = 1; i < table.length / 6; i++) {
    assert.ok(Buffer.compare(Buffer.from(table.subarray((i - 1) * 6, i * 6 - 1)), Buffer.from(table.subarray(i * 6, i * 6 + 5))) < 0);
  }
});

test("each seal gets fresh salts, key fragment and ciphertext", async () => {
  const a = await seal();
  const b = await seal();
  assert.notEqual(a.meta.id, b.meta.id);
  assert.notEqual(a.meta.t, b.meta.t);
  assert.notEqual(a.meta.k, b.meta.k);
  assert.notEqual(a.meta.c, b.meta.c);
  assert.notDeepEqual(a.table, b.table);
});

test("scores allowed guesses from the table, rejects unknown words, and reveals after a loss", async () => {
  const { meta, table } = await seal();
  const p = await openPuzzle(meta, table);
  assert.deepEqual(await p.score("crane"), ["correct", "correct", "correct", "correct", "correct"]);
  assert.deepEqual(await p.score("react"), ["present", "present", "correct", "present", "absent"]);
  assert.equal(await p.score("zzzzz"), null);
  assert.equal(await p.score("bean"), null);
  assert.equal(await p.reveal(), WORD);
  assert.ok(!JSON.stringify(Object.keys(p)).includes(WORD));
});

test("the answer is accepted even when it isn't in the guess list", async () => {
  const { meta, table } = await seal("rajma", ["crane", "hello"]);
  const p = await openPuzzle(meta, table);
  assert.deepEqual(await p.score("rajma"), Array(5).fill("correct"));
  assert.deepEqual(await p.score("crane"), ["absent", "present", "present", "absent", "absent"]);
});

test("duplicate letters are scored like Wordle", async () => {
  const p = await openPuzzle(...Object.values(await seal("hello")));
  assert.deepEqual(await p.score("lolly"), ["absent", "present", "correct", "correct", "absent"]);
  const q = await openPuzzle(...Object.values(await seal("tetes", ["tstse"])));
  assert.deepEqual(await q.score("tstse"), ["correct", "present", "correct", "absent", "present"]);
});

test("feedbackCode round-trips every pattern", () => {
  assert.equal(feedbackCode("crane", "crane"), 242);
  assert.equal(feedbackCode("zzzzz", "crane"), 0);
});

test("tampered puzzles don't score or reveal", async () => {
  const { meta, table } = await seal();
  const wrongId = await openPuzzle({ ...meta, id: "0123456789abcdef" }, table);
  assert.equal(await wrongId.score("crane"), null);
  await assert.rejects(wrongId.reveal());
  const flipped = meta.c.slice(0, -2) + (meta.c.endsWith("00") ? "01" : "00");
  await assert.rejects((await openPuzzle({ ...meta, c: flipped }, table)).reveal());
  const otherTable = (await seal()).table;
  await assert.rejects((await openPuzzle(meta, otherTable)).reveal());
  await assert.rejects(openPuzzle(meta, table.subarray(1)));
});

test("sealPuzzle validates input and honours a fixed id", async () => {
  await assert.rejects(seal("bean"));
  await assert.rejects(seal("be4ns"));
  await assert.rejects(seal(WORD, GUESSES, { id: "xyz" }));
  const { meta, table } = await seal(WORD, GUESSES, { id: "00112233aabbccdd" });
  assert.equal(meta.id, "00112233aabbccdd");
  assert.equal((await openPuzzle(meta, table)).id, "00112233aabbccdd");
});

test("guess list is five-letter lowercase words", () => {
  assert.ok(VALID_GUESSES.length > 2000);
  assert.ok(VALID_GUESSES.every((w) => /^[a-z]{5}$/.test(w)));
});