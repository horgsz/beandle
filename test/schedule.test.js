import { test } from "node:test";
import assert from "node:assert/strict";
import { puzzleDate, parseWords, wordForDate, puzzleIdFor, choosePuzzle, dayNumber, START_DATE, eventDay, EVENT_DAYS, rolloverInstant, upcoming } from "../scripts/schedule.mjs";

test("event days count from launch day", () => {
  assert.equal(eventDay(START_DATE), 1);
  assert.equal(eventDay("2026-10-24"), EVENT_DAYS);
  assert.equal(choosePuzzle({ words: "apple crane", seed: "test-seed-0123456789abcdef", now: new Date("2026-10-18T03:00:00Z") }).day, 3);
});

test("the new bean goes live at exactly 12:00 Sydney, in summer and winter", () => {
  assert.equal(rolloverInstant("2026-10-17").toISOString(), "2026-10-17T01:00:00.000Z"); // AEDT
  assert.equal(rolloverInstant("2026-07-15").toISOString(), "2026-07-15T02:00:00.000Z"); // AEST
  assert.equal(rolloverInstant("2026-04-05").toISOString(), "2026-04-05T02:00:00.000Z"); // DST ends that morning
  assert.equal(rolloverInstant("2026-10-04").toISOString(), "2026-10-04T01:00:00.000Z"); // DST starts that morning
});

test("tomorrow's puzzle is preloaded all day, but never goes live before noon", () => {
  // AEDT: noon on the 17th = 01:00 UTC on the 17th
  for (const t of ["2026-10-16T01:07:00Z", "2026-10-16T05:00:00Z", "2026-10-16T21:59:00Z", "2026-10-17T00:41:00Z"]) {
    const up = upcoming(new Date(t)); // 12:07pm on the 16th through 11:41am on the 17th
    assert.equal(up.date, "2026-10-17");
    assert.equal(up.liveAt.toISOString(), "2026-10-17T01:00:00.000Z");
  }
  // Once the 17th's bean is live, builds preload the 18th's instead.
  assert.equal(upcoming(new Date("2026-10-17T01:07:00Z")).date, "2026-10-18");
  // AEST: noon on 15 Jul = 02:00 UTC
  assert.equal(upcoming(new Date("2026-07-15T01:37:00Z")).date, "2026-07-15");
  assert.equal(upcoming(new Date("2026-07-15T02:41:00Z")).date, "2026-07-16");
  // Noon-to-noon over the end of daylight saving is 25 hours: the first hour has no preload.
  assert.equal(upcoming(new Date("2026-04-04T01:30:00Z")), null); // 12:30pm AEDT, Sat 4 Apr
  assert.equal(upcoming(new Date("2026-04-04T03:00:00Z")).date, "2026-04-05");
});

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
