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

test("the built site publishes only the minified bundle and puzzle files, never the word", async () => {
  execFileSync(process.execPath, [join(root, "scripts/build-site.mjs")], {
    cwd: root,
    env: { ...process.env, BEANDLE_WORDS: "", BEANDLE_SEED: "build-test-seed-0123456789", BEANDLE_OVERRIDE: ANSWER },
    stdio: "pipe",
  });

  assert.deepEqual((await readdir(site)).sort(), ["app.js", "index.html", "puzzle.bin", "puzzle.json", "style.css"]);

  const app = await readFile(join(site, "app.js"), "utf8");
  // No guess-word list and no readable module source in the bundle.
  assert.ok(!app.includes("aback") && !app.includes("VALID_GUESSES"));
  assert.ok(app.split("\n").length < 10, "bundle is minified");
  assert.match(await readFile(join(site, "index.html"), "utf8"), /src="app\.js"/);

  const meta = JSON.parse(await readFile(join(site, "puzzle.json"), "utf8"));
  const table = new Uint8Array(await readFile(join(site, "puzzle.bin")));
  const everything = [app, JSON.stringify(meta), Buffer.from(table).toString("latin1"), Buffer.from(table).toString("hex")]
    .join("\n").toLowerCase();
  assert.ok(!everything.includes(ANSWER));

  const p = await openPuzzle(meta, table);
  assert.deepEqual(await p.score(ANSWER), Array(5).fill("correct"));
  assert.ok(await p.score("crane"));
});
