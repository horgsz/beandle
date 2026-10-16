#!/usr/bin/env node
// Set a Beandle word by hand.
//
//   node scripts/set-word.mjs [WORD]            # local: write docs/puzzle.json for `npm run serve`
//   node scripts/set-word.mjs --remote [WORD]   # live site: set the BEANDLE_OVERRIDE secret and redeploy
//   node scripts/set-word.mjs --clear-remote    # live site: delete the override and redeploy (back to schedule)
//
// Without WORD you're prompted for it, so it stays out of your shell history.
// --remote/--clear-remote need the GitHub CLI (`gh`), logged in with access to the repo.

import { writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { sealPuzzle, openPuzzle } from "../docs/beanbox.js";
import { VALID_GUESSES } from "../docs/words.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const puzzlePath = join(root, "docs", "puzzle.json");
const WORKFLOW = "deploy.yml";

function fail(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log("Usage: node scripts/set-word.mjs [WORD] [--remote | --clear-remote]");
  process.exit(0);
}
const flags = new Set(args.filter((a) => a.startsWith("-")));
const positional = args.filter((a) => !a.startsWith("-"));
for (const f of flags) {
  if (!["--remote", "--clear-remote"].includes(f)) fail(`Unknown option ${f}`);
}
if (flags.size > 1) fail("Use only one of --remote / --clear-remote.");
if (positional.length > 1) fail("Pass a single word.");

const gh = (args, input) => {
  try {
    execFileSync("gh", args, { cwd: root, input, stdio: [input === undefined ? "inherit" : "pipe", "inherit", "inherit"] });
  } catch (e) {
    fail(e.code === "ENOENT" ? "GitHub CLI (gh) not found. Install it from https://cli.github.com/" : `gh ${args[0]} ${args[1]} failed`);
  }
};

if (flags.has("--clear-remote")) {
  if (positional.length) fail("--clear-remote doesn't take a word.");
  gh(["secret", "delete", "BEANDLE_OVERRIDE"]);
  gh(["workflow", "run", WORKFLOW]);
  console.log("✔ Override cleared. Redeploying with the scheduled word (takes a minute or two).");
  process.exit(0);
}

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
    // Echo asterisks instead of the typed letters.
    rl._writeToOutput = (s) => {
      if (s === "\r\n" || s === "\n") rl.output.write(s);
      else rl.output.write(`\x1b[2K\x1b[200D${question}${"*".repeat(rl.line.length)}`);
    };
  });
}

let word = positional[0];
if (!word) {
  if (!process.stdin.isTTY) fail("Pass the word as an argument, e.g. node scripts/set-word.mjs STONE");
  word = await promptHidden("Bean word (5 letters): ");
}
word = word.trim().toLowerCase();
if (!/^[a-z]{5}$/.test(word)) fail("The word must be exactly 5 letters A–Z.");
const offList = !VALID_GUESSES.includes(word);

if (flags.has("--remote")) {
  gh(["secret", "set", "BEANDLE_OVERRIDE"], word);
  gh(["workflow", "run", WORKFLOW]);
  console.log("✔ Override set. Redeploying now (takes a minute or two); players get a fresh game.");
  console.log("  It stays in effect each day until you run: node scripts/set-word.mjs --clear-remote");
} else {
  const puzzle = await sealPuzzle(word);
  const check = await (await openPuzzle(puzzle)).score(word);
  if (!check.every((s) => s === "correct")) fail("Self-check failed; puzzle not written.");
  await writeFile(puzzlePath, `${JSON.stringify(puzzle, null, 2)}\n`);
  console.log(`✔ Wrote ${relative(process.cwd(), puzzlePath) || puzzlePath} for local play (git-ignored). Run: npm run serve`);
}
if (offList) console.log("  Note: that word isn't in docs/words.js, but it will still be accepted as the answer.");