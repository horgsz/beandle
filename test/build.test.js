import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { openPuzzle } from "../docs/beanbox.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const site = join(root, "_site");
const ANSWER = "pinto";
const FACT = "Speckled like a painted horse, so the story goes.";

test("the built site publishes only the minified bundle and puzzle files, never the word", async () => {
  execFileSync(process.execPath, [join(root, "scripts/build-site.mjs")], {
    cwd: root,
    env: {
      ...process.env,
      BEANDLE_WORDS: "",
      BEANDLE_SEED: "build-test-seed-0123456789",
      BEANDLE_OVERRIDE: ANSWER,
      BEANDLE_FACTS: JSON.stringify({ PINTO: FACT, crane: "not today" }),
      BEANDLE_NOW: "2026-10-17T05:00:00Z", // 4pm Sydney: no preload
    },
    stdio: "pipe",
  });

  assert.deepEqual((await readdir(site)).sort(), ["app.js", "index.html", "puzzle.bin", "puzzle.json", "style.css"]);

  const app = await readFile(join(site, "app.js"), "utf8");
  // No guess-word list and no readable module source in the bundle.
  assert.ok(!app.includes("aback") && !app.includes("VALID_GUESSES"));
  assert.ok(!app.includes("// ----") && !/\n {2,}\S/.test(app), "bundle is minified");
  assert.match(await readFile(join(site, "index.html"), "utf8"), /src="app\.js"/);

  const meta = JSON.parse(await readFile(join(site, "puzzle.json"), "utf8"));
  const table = new Uint8Array(await readFile(join(site, "puzzle.bin")));
  const everything = [app, JSON.stringify(meta), Buffer.from(table).toString("latin1"), Buffer.from(table).toString("hex")]
    .join("\n").toLowerCase();
  assert.ok(!everything.includes(ANSWER));
  assert.ok(!everything.includes("painted horse") && !everything.includes("not today"));

  const p = await openPuzzle(meta, table);
  assert.deepEqual(await p.score(ANSWER), Array(5).fill("correct"));
  assert.ok(await p.score("crane"));
  assert.equal(await p.fact(ANSWER), FACT);
  assert.ok(Number.isInteger(p.day));
});

test("morning builds also ship tomorrow's puzzle, locked until 12pm Sydney", async () => {
  execFileSync(process.execPath, [join(root, "scripts/build-site.mjs")], {
    cwd: root,
    env: {
      ...process.env,
      BEANDLE_WORDS: "pinto, crane, ghost",
      BEANDLE_SEED: "build-test-seed-0123456789",
      BEANDLE_OVERRIDE: "",
      BEANDLE_FACTS: "",
      BEANDLE_NOW: "2026-10-17T00:07:00Z", // 11:07am Sydney on the 17th
    },
    stdio: "pipe",
  });
  assert.deepEqual((await readdir(site)).sort(), ["app.js", "index.html", "next.bin", "next.json", "puzzle.bin", "puzzle.json", "style.css"]);
  const cur = JSON.parse(await readFile(join(site, "puzzle.json"), "utf8"));
  const next = JSON.parse(await readFile(join(site, "next.json"), "utf8"));
  assert.equal(next.liveAt, "2026-10-17T01:00:00.000Z");
  assert.equal(next.d, cur.d + 1);
  assert.notEqual(next.id, cur.id);
  for (const w of ["pinto", "crane", "ghost"]) assert.ok(!JSON.stringify(next).includes(w));
  const p = await openPuzzle(next, new Uint8Array(await readFile(join(site, "next.bin"))));
  const word = await p.reveal();
  assert.ok(["pinto", "crane", "ghost"].includes(word));
  assert.deepEqual(await p.score(word), Array(5).fill("correct"));
});
