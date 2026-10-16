#!/usr/bin/env node
// Build the GitHub Pages site into _site/ with today's puzzle.
//
// Reads secrets from the environment (never printed):
//   BEANDLE_WORDS     bean answer list (commas, spaces or newlines)
//   BEANDLE_SEED      random secret seed
//   BEANDLE_OVERRIDE  optional: force this word instead of the schedule
// BEANDLE_NOW (ISO timestamp) can be set locally to preview another moment.
//
// Output: index.html, style.css, a single minified app.js, puzzle.json and puzzle.bin.
// The readable source and the plain guess-word list are not published.

import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { build } from "esbuild";
import { sealPuzzle, openPuzzle } from "../docs/beanbox.js";
import { VALID_GUESSES } from "../docs/words.js";
import { choosePuzzle, upcoming } from "./schedule.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const docs = join(root, "docs");
const out = join(root, "_site");

function fail(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

const now = process.env.BEANDLE_NOW ? new Date(process.env.BEANDLE_NOW) : new Date();
const secrets = {
  words: process.env.BEANDLE_WORDS,
  seed: process.env.BEANDLE_SEED,
  override: process.env.BEANDLE_OVERRIDE,
};

let chosen;
let next = null;
try {
  chosen = choosePuzzle({ ...secrets, now });
  // In the hours before the rollover, also ship tomorrow's puzzle (locked until it goes live),
  // so the site switches exactly on time even if a scheduled run is late.
  const up = upcoming(now);
  if (up) next = { ...choosePuzzle({ ...secrets, now: up.liveAt }), liveAt: up.liveAt.toISOString() };
} catch (e) {
  fail(e.message);
}

// Optional private bean facts (JSON object: word → fact). Kept in a secret rather than the
// repo because a public list of facts would give away which beans are answers.
let facts = {};
if (process.env.BEANDLE_FACTS) {
  try {
    const parsed = JSON.parse(process.env.BEANDLE_FACTS);
    if (parsed && typeof parsed === "object") {
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "string" && v.trim()) facts[String(k).trim().toLowerCase()] = v.trim().slice(0, 400);
      }
    }
  } catch {
    console.log("⚠ BEANDLE_FACTS isn't valid JSON; using general bean facts instead");
  }
}
/** Seal one puzzle and self-check it. The word is dropped from `pick` afterwards. */
async function seal(pick) {
  const fact = facts[pick.word] || null;
  const sealed = await sealPuzzle(pick.word, VALID_GUESSES, { id: pick.id, day: pick.day, fact });
  const opened = await openPuzzle(sealed.meta, sealed.table);
  const check = await opened.score(pick.word);
  const revealOk = (await opened.reveal()) === pick.word;
  const factOk = !fact || (await opened.fact(pick.word)) === fact;
  pick.word = null;
  if (!check || !check.every((s) => s === "correct") || !revealOk || !factOk) fail("Self-check failed");
  return { ...sealed, hasFact: !!fact };
}

const current = await seal(chosen);
const nextSealed = next ? await seal(next) : null;

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

await build({
  entryPoints: [join(docs, "game.js")],
  bundle: true,
  minify: true,
  format: "esm",
  target: ["es2020"],
  legalComments: "none",
  outfile: join(out, "app.js"),
  logLevel: "warning",
});

const html = await readFile(join(docs, "index.html"), "utf8");
if (!html.includes('src="game.js"')) fail("index.html no longer loads game.js");
await writeFile(join(out, "index.html"), html.replace('src="game.js"', 'src="app.js"'));
await copyFile(join(docs, "style.css"), join(out, "style.css"));
await writeFile(join(out, "puzzle.json"), `${JSON.stringify(current.meta)}\n`);
await writeFile(join(out, "puzzle.bin"), current.table);
if (nextSealed) {
  await writeFile(join(out, "next.json"), `${JSON.stringify({ ...nextSealed.meta, liveAt: next.liveAt })}\n`);
  await writeFile(join(out, "next.bin"), nextSealed.table);
}

console.log(`✔ Built _site for puzzle day ${chosen.date}, bean ${chosen.day} (${chosen.source}${current.hasFact ? ", with fact" : ""})`);
if (next) console.log(`✔ Preloaded bean ${next.day} (${next.date}), live at ${next.liveAt}${nextSealed.hasFact ? ", with fact" : ""}`);
