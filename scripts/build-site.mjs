#!/usr/bin/env node
// Build the GitHub Pages site into _site/ with today's sealed puzzle.
//
// Reads secrets from the environment (never printed):
//   BEANDLE_WORDS     bean answer list (commas, spaces or newlines)
//   BEANDLE_SEED      random secret seed
//   BEANDLE_OVERRIDE  optional: force this word instead of the schedule
// BEANDLE_NOW (ISO timestamp) can be set locally to preview another moment.

import { cp, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sealPuzzle, openPuzzle } from "../docs/beanbox.js";
import { choosePuzzle } from "./schedule.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "_site");

function fail(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

let chosen;
try {
  chosen = choosePuzzle({
    words: process.env.BEANDLE_WORDS,
    seed: process.env.BEANDLE_SEED,
    override: process.env.BEANDLE_OVERRIDE,
    now: process.env.BEANDLE_NOW ? new Date(process.env.BEANDLE_NOW) : new Date(),
  });
} catch (e) {
  fail(e.message);
}

const puzzle = await sealPuzzle(chosen.word, { id: chosen.id });
const check = await (await openPuzzle(puzzle)).score(chosen.word);
chosen.word = null;
if (!check.every((s) => s === "correct")) fail("Self-check failed");

await rm(out, { recursive: true, force: true });
await cp(join(root, "docs"), out, {
  recursive: true,
  filter: (src) => !src.endsWith("puzzle.json"),
});
await writeFile(join(out, "puzzle.json"), `${JSON.stringify(puzzle)}\n`);

console.log(`✔ Built _site for puzzle day ${chosen.date} (${chosen.source})`);
