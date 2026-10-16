// Daily word selection for the GitHub Actions build. Pure functions; nothing here logs.
import { createHmac } from "node:crypto";

export const ROLLOVER_HOUR = 12;
export const TIME_ZONE = "Australia/Sydney";

/** Sydney calendar date and hour for an instant. */
export function sydneyParts(now) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-AU", {
      timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
    }).formatToParts(now).map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

/**
 * The puzzle date for an instant: today's Sydney date from 12:00 (noon) Sydney time, otherwise yesterday's.
 * Being stateless, any number of (possibly delayed) runs on the same puzzle day produce the same puzzle.
 */
export function puzzleDate(now = new Date()) {
  const { date, hour } = sydneyParts(now);
  if (hour >= ROLLOVER_HOUR) return date;
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function dayNumber(date) {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);
}

/** Parse a word list (commas, whitespace or newlines). Throws without echoing any words. */
export function parseWords(raw) {
  const words = [...new Set(String(raw || "").split(/[\s,;]+/).filter(Boolean).map((w) => w.toLowerCase()))];
  const bad = words.filter((w) => !/^[a-z]{5}$/.test(w)).length;
  if (bad) throw new Error(`${bad} entr${bad === 1 ? "y is" : "ies are"} not 5 letters A–Z`);
  if (!words.length) throw new Error("word list is empty");
  return words.sort();
}

function hmac(seed, message) {
  return createHmac("sha256", seed).update(message).digest();
}

/** Fisher–Yates shuffle driven by HMAC(seed, cycle). */
function shuffled(words, seed, cycle) {
  const out = [...words];
  let block = Buffer.alloc(0);
  let counter = 0;
  let offset = 0;
  const next = () => {
    if (offset + 4 > block.length) {
      block = hmac(seed, `shuffle:${cycle}:${counter++}`);
      offset = 0;
    }
    const v = block.readUInt32BE(offset);
    offset += 4;
    return v;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = next() % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** First puzzle day. Cycles through the word list are counted from here. */
export const START_DATE = "2026-10-16";

/** Length of the group event; the client shows "Bean N of EVENT_DAYS" and a finale on the last day. */
export const EVENT_DAYS = 9;

/** 1-based event day for a puzzle date (day 1 = START_DATE). */
export function eventDay(date) {
  return dayNumber(date) - dayNumber(START_DATE) + 1;
}

/**
 * Word for a puzzle date. From START_DATE the words follow one seeded shuffle, repeated
 * forever, so every word comes back exactly every list-length days and any run of that
 * many consecutive days has no repeats.
 */
export function wordForDate(words, seed, date) {
  const day = dayNumber(date) - dayNumber(START_DATE);
  const n = words.length;
  return shuffled(words, seed, 0)[((day % n) + n) % n];
}

/** Puzzle id: keyed by the secret seed so it reveals nothing about the word. */
export function puzzleIdFor(seed, date, override) {
  const msg = override ? `override:${date}:${override}` : `day:${START_DATE}:${date}`;
  return hmac(seed, msg).subarray(0, 8).toString("hex");
}

/** Resolve the puzzle for an instant from the secret inputs. */
export function choosePuzzle({ words, seed, override, now = new Date() }) {
  if (!seed || String(seed).length < 16) throw new Error("BEANDLE_SEED must be set (at least 16 characters)");
  const date = puzzleDate(now);
  const o = String(override || "").trim().toLowerCase();
  if (o) {
    if (!/^[a-z]{5}$/.test(o)) throw new Error("BEANDLE_OVERRIDE must be 5 letters A–Z");
    return { date, day: eventDay(date), word: o, id: puzzleIdFor(seed, date, o), source: "override" };
  }
  const list = parseWords(words);
  return { date, day: eventDay(date), word: wordForDate(list, seed, date), id: puzzleIdFor(seed, date), source: "schedule" };
}
