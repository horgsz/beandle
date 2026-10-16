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
import { choosePuzzle } from "./schedule.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const docs = join(root, "docs");
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

const { meta, table } = await sealPuzzle(chosen.word, VALID_GUESSES, { id: chosen.id });
const opened = await openPuzzle(meta, table);
const check = await opened.score(chosen.word);
const revealOk = (await opened.reveal()) === chosen.word;
chosen.word = null;
if (!check || !check.every((s) => s === "correct") || !revealOk) fail("Self-check failed");

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
await writeFile(join(out, "puzzle.json"), `${JSON.stringify(meta)}\n`);
await writeFile(join(out, "puzzle.bin"), table);

console.log(`✔ Built _site for puzzle day ${chosen.date} (${chosen.source})`);