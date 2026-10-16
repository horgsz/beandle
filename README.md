# Beandle 🫘

A Wordle clone where every answer is a five-letter **bean**. A new bean is planted every day at **5am Sydney time**, and friends play it on GitHub Pages.

- 6 guesses to find a 5-letter word, with green/yellow/grey feedback on bean-shaped tiles
- On-screen keyboard plus physical keyboard (letters, Enter, Backspace)
- Built for phones: fits portrait screens without scrolling, large tap targets, safe-area aware, no double-tap zoom
- Progress and stats are saved per puzzle in the browser; results can be shared as an emoji grid
- Static site with no backend. The answer list lives only in GitHub secrets, and the browser never receives the day's word to score with; it gets a scrambled feedback table generated at deploy time

## Repo layout

| Path | Purpose |
| --- | --- |
| `docs/` | Website source (`index.html`, `style.css`, `game.js`, `beanbox.js`); the build bundles it into one minified `app.js` |
| `docs/words.js` | Words accepted as guesses (used at build time only, never published). The day's answer is always accepted |
| `docs/beanbox.js` | Builds and reads the feedback table and sealed answer (see [How the word is hidden](#how-the-word-is-hidden)) |
| `.github/workflows/deploy.yml` | Builds the site with the day's puzzle and deploys it to Pages |
| `scripts/build-site.mjs` | Used by the workflow: picks the day's word from the secrets and writes `_site/` |
| `scripts/schedule.mjs` | Puzzle-day and word-selection logic (Sydney 5am rollover, seeded shuffle) |
| `scripts/set-word.mjs` | Manual word setting, either locally or as a live override |
| `test/` | `npm test` (Node's built-in test runner; run `npm install` first) |

## Setup

You need [Node.js](https://nodejs.org/) 20+ and the [GitHub CLI](https://cli.github.com/) (`gh auth login`).

### 1. Create the repo and push

Create a **public**, empty repository at `github.com/horgsz/beandle` (no README, .gitignore or license). Then:

```sh
git branch -M main
git remote add origin https://github.com/horgsz/beandle.git
git push -u origin main
```

The first workflow run fails until steps 2 and 3 are done. That's expected.

### 2. Add the secrets

In the repo go to **Settings → Secrets and variables → Actions → New repository secret**, or use `gh` from this folder:

| Secret | Required | What it is |
| --- | --- | --- |
| `BEANDLE_WORDS` | yes | Your answer list: 5-letter words separated by commas, spaces or newlines (case doesn't matter) |
| `BEANDLE_SEED` | yes | A long random string. It decides the order the words come up in and the puzzle ids |
| `BEANDLE_OVERRIDE` | no | Forces a specific word (see [Manual override](#manual-override)). Leave unset normally |

```sh
# Paste your list on one line when prompted (input is hidden and not saved locally):
gh secret set BEANDLE_WORDS

# Generate and store a random seed without ever printing it:
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" | gh secret set BEANDLE_SEED
```

If you keep the list in a file, call it `beans.txt` (it's git-ignored) and use `gh secret set BEANDLE_WORDS < beans.txt`.

Words are used in a shuffled order starting on launch day (`START_DATE` in `scripts/schedule.mjs`). The same shuffled order then repeats, so each word comes back exactly every N days (N = number of words) and no word repeats within any N consecutive days. Changing the list or the seed changes the order from then on.

### 3. Turn on GitHub Pages

1. Go to **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Go to **Actions → Deploy Beandle → Run workflow** (or run `gh workflow run deploy.yml`) to publish straight away.

The site goes live at **https://horgsz.github.io/beandle/**.

## How the daily word works

`.github/workflows/deploy.yml` runs:

- **Every day on a schedule**, at 18:05 UTC (5:05am AEDT), 19:05 UTC (5:05am AEST), and 21:41 UTC as a fallback. GitHub's cron is UTC-only and runs can be late, so it runs at all three times instead of relying on one exact hour.
- **On every push to `main`**, and **on demand** (Run workflow / `gh workflow run deploy.yml`).

Each run works out the **puzzle day**: today's Sydney date if it's 5am or later in Sydney, otherwise yesterday's. It then picks that day's word from the seeded shuffle and seals it into `puzzle.json` inside the Pages artifact. Nothing gets committed.

This is stateless, so extra or late runs are harmless. Every run on the same puzzle day produces the same puzzle id, so players' progress is kept. A new day gets a new id, so everyone gets a fresh board. Daylight saving is handled by checking actual Sydney time.

The workflow log only shows the puzzle date and whether the word came from the schedule or the override. It never prints the word, the list or anything derived from them.

> GitHub pauses scheduled workflows in public repos after 60 days without any commits. If the daily word stops changing, push any commit or re-enable the workflow under **Actions**.

## Manual override

To replace today's word on the live site:

```sh
node scripts/set-word.mjs --remote
```

You'll be prompted for the word, shown as `*`. The script stores it as the `BEANDLE_OVERRIDE` secret and starts a deploy. Players get a fresh board within a couple of minutes. Workflow inputs are public, so the word is only ever passed as a secret.

The override stays in effect every day, with a fresh board each day, until you clear it:

```sh
node scripts/set-word.mjs --clear-remote
```

This deletes the secret and redeploys, back to the scheduled word. The manual equivalents are `gh secret set BEANDLE_OVERRIDE` + `gh workflow run deploy.yml`, then `gh secret delete BEANDLE_OVERRIDE` + `gh workflow run deploy.yml`.

## Playing and testing locally

Run `npm install` once (it installs esbuild, used to bundle the site). The game must be served over http(s), because it uses Web Crypto and `fetch`. Opening `index.html` from disk won't work.

```sh
node scripts/set-word.mjs        # prompts for a word; writes docs/puzzle.json + docs/puzzle.bin (git-ignored)
npm run serve                    # = python3 -m http.server 8000 --directory docs
```

Open http://localhost:8000. To test the real build with a throwaway list and seed:

```sh
BEANDLE_WORDS="apple ghost stone" BEANDLE_SEED=some-local-test-seed npm run build
python3 -m http.server 8000 --directory _site
# Preview another moment, e.g. just after 5am Sydney on 17 Oct 2026:
BEANDLE_NOW=2026-10-16T18:05:00Z BEANDLE_WORDS="apple ghost stone" BEANDLE_SEED=some-local-test-seed npm run build
```

Run the tests with `npm test`.

## How the word is hidden

The answer list and seed exist only as GitHub secrets. They never appear in the repo, the built site or the workflow logs. Each day's puzzle files are generated inside the deploy job and never committed.

**The browser never gets the answer in order to score guesses.** Each build publishes:

- **`puzzle.bin`, a feedback table:** one 6-byte entry for every allowed guess word (about 16,000) plus the answer.
  - Each entry's key and mask come from a slow hash of the guess word: PBKDF2-SHA-256 with 40,000 rounds, salted per build and per puzzle, plus a pepper stored scrambled in the code.
  - The stored byte is that guess's green/yellow/grey pattern, XOR-masked.
  - Entries are sorted by key, so the table has no word order and no readable "all green" entry.
  - To score a guess, the game hashes it and looks it up. No entry means it isn't an allowed word.
- **A sealed answer in `puzzle.json`, used only to show the word after a 6th miss:**
  - The letters are XOR-masked and scattered among random bytes.
  - That block is encrypted with AES-256-GCM, bound to the puzzle id.
  - The key comes from a much slower PBKDF2 (400,000 rounds) over split inputs: the pepper, a per-build key fragment, the puzzle id and a digest of the table.
- **`app.js`:** the game code, bundled and minified with esbuild. The readable source and the plain guess-word list aren't published.

The puzzle id is an HMAC of the puzzle date (plus the override word, if any) keyed with `BEANDLE_SEED`. It tells you nothing about the word.

**Limits:** this is obfuscation, not secrecy. Everything needed to play runs in the browser, so someone willing to reverse-engineer the minified code can still get the word. They'd have to either:
- trigger the loss reveal, or
- hash likely bean names against the table.

That's real effort, compared with the old "two lines in the console". Making the word truly secret would need a small server to score guesses, such as a Cloudflare Worker.
