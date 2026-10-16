import { test } from "node:test";
import assert from "node:assert/strict";
import { puzzleDate, parseWords, wordForDate, puzzleIdFor, choosePuzzle, dayNumber, START_DATE } from "../scripts/schedule.mjs";

const SEED = "test-seed-0123456789abcdef";
const WORDS = "apple, crane, slate, trace, flint\nghost plumb river stone quilt";

test("puzzle day rolls over at 12:00 (noon) Sydney in summer (AEDT, UTC+11)", () => {
  // 2026-01-15 12:00 AEDT = 2026-01-15 01:00 UTC
  assert.equal(puzzleDate(new Date("2026-01-15T00:59:00Z")), "2026-01-14");
  assert.equal(puzzleDate(new Date("2026-01-15T01:00:00Z")), "2026-01-15");
  assert.equal(puzzleDate(new Date("2026-01-15T01:05:00Z")), "2026-01-15");
  // 02:05 UTC run in summer is 13:05: same day, so same puzzle
  assert.equal(puzzleDate(new Date("2026-01-15T02:05:00Z")), "2026-01-15");
  // 06:00 Sydney the next morning is still the 15th's puzzle
  assert.equal(puzzleDate(new Date("2026-01-15T19:00:00Z")), "2026-01-15");
});

test("puzzle day rolls over at 12:00 (noon) Sydney in winter (AEST, UTC+10)", () => {
  // 2026-07-15 12:00 AEST = 2026-07-15 02:00 UTC
  assert.equal(puzzleDate(new Date("2026-07-15T01:05:00Z")), "2026-07-14"); // 11:05, still yesterday
  assert.equal(puzzleDate(new Date("2026-07-15T02:05:00Z")), "2026-07-15");
  assert.equal(puzzleDate(new Date("2026-07-15T04:41:00Z")), "2026-07-15"); // fallback run
  assert.equal(puzzleDate(new Date("2026-07-15T13:59:00Z")), "2026-07-15"); // 23:59 Sydney
  assert.equal(puzzleDate(new Date("2026-07-16T01:59:00Z")), "2026-07-15"); // 11:59 next day
});

test("delayed runs still land on the right day", () => {
  // Run scheduled 01:05 UTC but delayed 3 hours, winter → 14:05 AEST
  assert.equal(puzzleDate(new Date("2026-07-15T04:05:00Z")), "2026-07-15");
});

test("DST transition days", () => {
  // DST ends 2026-04-05 03:00 AEDT → 02:00 AEST. 12:00 AEST on 04-05 = 04-05 02:00 UTC.
  assert.equal(puzzleDate(new Date("2026-04-05T01:05:00Z")), "2026-04-04");
  assert.equal(puzzleDate(new Date("2026-04-05T02:05:00Z")), "2026-04-05");
  // DST starts 2026-10-04 02:00 AEST → 03:00 AEDT. 12:00 AEDT on 10-04 = 10-04 01:00 UTC.
  assert.equal(puzzleDate(new Date("2026-10-04T00:55:00Z")), "2026-10-03");
  assert.equal(puzzleDate(new Date("2026-10-04T01:05:00Z")), "2026-10-04");
});

test("parseWords normalises and rejects bad entries without echoing them", () => {
  assert.deepEqual(parseWords("Apple,CRANE  apple\nghost"), ["apple", "crane", "ghost"]);
  assert.throws(() => parseWords("apple, secretword"), (e) => !e.message.includes("secretword"));
  assert.throws(() => parseWords(""));
});

test("word selection is deterministic and cycles through every word before repeating", () => {
  const list = parseWords(WORDS);
  const start = dayNumber(START_DATE);
  const cycle = [];
  for (let i = 0; i < list.length; i++) {
    const date = new Date((start + i) * 86400000).toISOString().slice(0, 10);
    cycle.push(wordForDate(list, SEED, date));
    assert.equal(wordForDate(list, SEED, date), cycle[i]);
  }
  assert.deepEqual([...cycle].sort(), list);
});

test("different seeds give different orders", () => {
  const list = parseWords(WORDS);
  const dates = Array.from({ length: 10 }, (_, i) => `2026-05-${String(i + 1).padStart(2, "0")}`);
  const a = dates.map((d) => wordForDate(list, SEED, d)).join();
  const b = dates.map((d) => wordForDate(list, "another-seed-abcdef0123", d)).join();
  assert.notEqual(a, b);
});

test("puzzle ids: stable per day, fresh per day and per override, independent of the word", () => {
  assert.equal(puzzleIdFor(SEED, "2026-05-01"), puzzleIdFor(SEED, "2026-05-01"));
  assert.notEqual(puzzleIdFor(SEED, "2026-05-01"), puzzleIdFor(SEED, "2026-05-02"));
  assert.notEqual(puzzleIdFor(SEED, "2026-05-01"), puzzleIdFor(SEED, "2026-05-01", "stone"));
  assert.notEqual(puzzleIdFor(SEED, "2026-05-01", "stone"), puzzleIdFor(SEED, "2026-05-01", "ghost"));
  assert.notEqual(puzzleIdFor(SEED, "2026-05-01"), puzzleIdFor("another-seed-abcdef0123", "2026-05-01"));
  assert.match(puzzleIdFor(SEED, "2026-05-01"), /^[0-9a-f]{16}$/);
});

test("choosePuzzle: schedule, override, and validation", () => {
  const now = new Date("2026-07-15T02:05:00Z");
  const s = choosePuzzle({ words: WORDS, seed: SEED, now });
  assert.equal(s.source, "schedule");
  assert.equal(s.date, "2026-07-15");
  assert.ok(parseWords(WORDS).includes(s.word));

  const o = choosePuzzle({ words: WORDS, seed: SEED, override: " stone ", now });
  assert.equal(o.source, "override");
  assert.equal(o.word, "stone");
  assert.notEqual(o.id, s.id);

  // Override works even without a word list
  assert.equal(choosePuzzle({ seed: SEED, override: "ghost", now }).word, "ghost");

  assert.throws(() => choosePuzzle({ words: WORDS, seed: "", now }), /BEANDLE_SEED/);
  assert.throws(() => choosePuzzle({ words: WORDS, seed: SEED, override: "toolong", now }), /BEANDLE_OVERRIDE/);
});

test("from launch day, any run of list-length consecutive days has no repeats", () => {
  const list = parseWords(WORDS);
  const n = list.length;
  for (const seed of [SEED, "another-seed-abcdef0123", "third-seed-0123456789abc"]) {
    const seq = Array.from({ length: n * 6 }, (_, i) => {
      const d = new Date(`${START_DATE}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + i);
      return wordForDate(list, seed, d.toISOString().slice(0, 10));
    });
    for (let i = 0; i + n <= seq.length; i++) assert.equal(new Set(seq.slice(i, i + n)).size, n);
  }
});
