import { openPuzzle, isSupported } from "./beanbox.js";

const WORD_LENGTH = 5;
const MAX_GUESSES = 6;
const FLIP_MS = 250;
const STATE_KEY = "beandle-state";
const STATS_KEY = "beandle-stats";
const HELP_KEY = "beandle-seen-help";

// Kidney-bean outline: bigger left lobe, dip in the top. Stretched to fill each tile.
const BEAN_PATH = "M65 18C50 18 44 4 28 4C12 4 2 20 2 46C2 76 30 98 65 98C100 98 128 76 128 46C128 20 118 4 102 4C86 4 80 18 65 18Z";
const BEAN_SVG = `<svg class="bean" viewBox="0 0 130 100" preserveAspectRatio="none" aria-hidden="true"><path d="${BEAN_PATH}"/><ellipse class="shine" cx="30" cy="28" rx="13" ry="6" transform="rotate(-24 30 28)"/></svg>`;

// ---- Persistence ----------------------------------------------------------

function load(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) || fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (e.g. private mode) */
  }
}

const stats = load(STATS_KEY, {
  played: 0, wins: 0, currentStreak: 0, maxStreak: 0,
  distribution: [0, 0, 0, 0, 0, 0], lastPuzzleId: null,
});

let puzzle = null;
let state = null;
let current = "";
let busy = true;
let revealed = null; // only set once the game is over

// ---- DOM ------------------------------------------------------------------

const boardEl = document.getElementById("board");
const keyboardEl = document.getElementById("keyboard");
const toastEl = document.getElementById("toast");
const helpModal = document.getElementById("help-modal");
const statsModal = document.getElementById("stats-modal");
const rows = [];
const keyEls = {};

for (let r = 0; r < MAX_GUESSES; r++) {
  const row = document.createElement("div");
  row.className = "row";
  const tiles = [];
  for (let c = 0; c < WORD_LENGTH; c++) {
    const tile = document.createElement("div");
    tile.className = "tile";
    tile.innerHTML = BEAN_SVG + '<span class="letter"></span>';
    row.appendChild(tile);
    tiles.push(tile);
  }
  boardEl.appendChild(row);
  rows.push({ el: row, tiles });
}

const KEY_ROWS = ["qwertyuiop", "asdfghjkl", ["enter", ..."zxcvbnm", "back"]];
KEY_ROWS.forEach((keys) => {
  const rowEl = document.createElement("div");
  rowEl.className = "kb-row";
  [...keys].forEach((k) => {
    const btn = document.createElement("button");
    btn.className = "key";
    btn.dataset.key = k;
    if (k === "enter") { btn.textContent = "Enter"; btn.classList.add("wide"); }
    else if (k === "back") { btn.textContent = "⌫"; btn.classList.add("wide"); btn.setAttribute("aria-label", "Backspace"); }
    else { btn.textContent = k; keyEls[k] = btn; }
    btn.addEventListener("click", (e) => { e.currentTarget.blur(); handleKey(k); });
    rowEl.appendChild(btn);
  });
  keyboardEl.appendChild(rowEl);
});

const RANK = { absent: 1, present: 2, correct: 3 };
function colourKey(letter, status) {
  const el = keyEls[letter];
  if (!el) return;
  const prev = el.dataset.status;
  if (!prev || RANK[status] > RANK[prev]) {
    el.dataset.status = status;
    el.classList.remove("absent", "present", "correct");
    el.classList.add(status);
  }
}

function paintRow(r, guess, result, animate) {
  const { tiles } = rows[r];
  return new Promise((resolve) => {
    result.forEach((status, i) => {
      const tile = tiles[i];
      tile.lastChild.textContent = guess[i];
      const apply = () => {
        tile.classList.remove("filled");
        tile.classList.add(status);
        colourKey(guess[i], status);
      };
      if (animate) {
        setTimeout(() => {
          tile.classList.add("reveal");
          setTimeout(apply, FLIP_MS);
        }, i * FLIP_MS);
      } else {
        apply();
      }
    });
    setTimeout(resolve, animate ? WORD_LENGTH * FLIP_MS + FLIP_MS : 0);
  });
}

function renderCurrent() {
  const r = state.guesses.length;
  if (r >= MAX_GUESSES) return;
  rows[r].tiles.forEach((tile, i) => {
    const ch = current[i] || "";
    tile.lastChild.textContent = ch;
    tile.classList.toggle("filled", !!ch);
  });
}

let toastTimer;
function toast(msg, ms = 1500) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(() => toastEl.classList.remove("show"), ms);
}

function shake() {
  const row = rows[state.guesses.length].el;
  row.classList.remove("shake");
  void row.offsetWidth;
  row.classList.add("shake");
}

// ---- Bean personality -----------------------------------------------------

const mascot = document.getElementById("mascot");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let moodTimer;

/** Mascot moods: idle | happy | oops | sad | cheer. `ms` 0 keeps the mood. */
function setMood(mood, ms = 1400) {
  mascot.dataset.mood = mood;
  clearTimeout(moodTimer);
  if (ms) moodTimer = setTimeout(() => { mascot.dataset.mood = "idle"; }, ms);
}

const FX_BEAN = `<svg viewBox="0 0 130 100" aria-hidden="true"><path d="${BEAN_PATH}"/></svg>`;

/** Rain little beans down the screen: a colourful shower to celebrate, a few sad ones to commiserate. */
function beanShower(kind) {
  if (reduceMotion) return;
  const colours = kind === "win"
    ? ["var(--correct)", "var(--present)", "var(--bean-red)", "var(--bean-cream)", "var(--absent)"]
    : ["var(--absent)", "var(--bean-brown)"];
  const count = kind === "win" ? 26 : 9;
  const layer = document.createElement("div");
  layer.className = `bean-fx ${kind}`;
  for (let i = 0; i < count; i++) {
    const b = document.createElement("span");
    b.className = "fx-bean";
    b.innerHTML = FX_BEAN;
    b.style.setProperty("--x", `${Math.random() * 100}%`);
    b.style.setProperty("--dx", `${Math.round((Math.random() - 0.5) * 140)}px`);
    b.style.setProperty("--rot", `${Math.round((Math.random() - 0.5) * 900)}deg`);
    b.style.setProperty("--delay", `${(Math.random() * (kind === "win" ? 0.5 : 1)).toFixed(2)}s`);
    b.style.setProperty("--size", `${Math.round(16 + Math.random() * 16)}px`);
    b.style.color = colours[i % colours.length];
    layer.appendChild(b);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 4000);
}

function beanBurst() {
  beanShower("win");
}

/** A little running commentary after a guess that didn't win. */
function reactToGuess(result) {
  const hits = result.filter((s) => s !== "absent").length;
  const greens = result.filter((s) => s === "correct").length;
  if (greens >= 4) { toast("So close! Almost bean-go!", 1300); setMood("cheer"); }
  else if (hits === 0) { toast("Not a bean in sight!", 1300); setMood("oops"); }
  else if (hits >= 3) setMood("happy");
}

// ---- Game flow ------------------------------------------------------------

const WIN_MESSAGES = [
  "Bean-credible!",
  "Un-bean-lievable!",
  "You spilled the beans!",
  "Full of beans!",
  "Bean there, done that!",
  "Phew! That was a close bean!",
];
const LOSE_MESSAGE = (word) => `Has-bean! It was ${word.toUpperCase()}`;
const isWin = (result) => result.every((s) => s === "correct");

async function submit() {
  if (current.length < WORD_LENGTH) { toast("Not enough beans in the pod"); shake(); setMood("oops"); return; }

  busy = true;
  const guess = current;
  // The table covers every allowed word (plus the answer); anything else scores null.
  const result = await puzzle.score(guess);
  if (!result) {
    busy = false;
    toast("Never bean heard of it");
    shake();
    setMood("oops");
    return;
  }

  const r = state.guesses.length;
  state.guesses.push(guess);
  current = "";
  save(STATE_KEY, state);
  await paintRow(r, guess, result, true);

  if (isWin(result)) {
    state.status = "won";
    revealed = guess;
    rows[r].el.classList.add("win");
    beanBurst();
    setMood("cheer", 0);
    toast(WIN_MESSAGES[r], 2200);
    finishGame(true, r + 1);
  } else if (state.guesses.length === MAX_GUESSES) {
    state.status = "lost";
    revealed = await puzzle.reveal();
    rows[r].el.classList.add("lose");
    beanShower("lose");
    setMood("sad", 0);
    toast(LOSE_MESSAGE(revealed), 0);
    finishGame(false);
  } else {
    reactToGuess(result);
  }
  save(STATE_KEY, state);
  busy = false;
}

function finishGame(won, guessCount) {
  if (stats.lastPuzzleId !== puzzle.id) {
    stats.played++;
    stats.lastPuzzleId = puzzle.id;
    if (won) {
      stats.wins++;
      stats.distribution[guessCount - 1]++;
      stats.currentStreak++;
      stats.maxStreak = Math.max(stats.maxStreak, stats.currentStreak);
    } else {
      stats.currentStreak = 0;
    }
    save(STATS_KEY, stats);
  }
  setTimeout(openStats, 1800);
}

function handleKey(key) {
  if (busy || !state || state.status !== "playing") return;
  if (key === "enter") submit();
  else if (key === "back") { current = current.slice(0, -1); renderCurrent(); }
  else if (/^[a-z]$/.test(key) && current.length < WORD_LENGTH) { current += key; renderCurrent(); }
}

function flashKey(key) {
  const el = keyboardEl.querySelector(`.key[data-key="${key}"]`);
  if (!el) return;
  el.classList.remove("pressed");
  void el.offsetWidth;
  el.classList.add("pressed");
}

document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (document.querySelector(".modal:not(.hidden)")) {
    if (e.key === "Escape") closeModals();
    return;
  }
  if (e.key === "Enter") { e.preventDefault(); flashKey("enter"); handleKey("enter"); }
  else if (e.key === "Backspace") { flashKey("back"); handleKey("back"); }
  else if (/^[a-zA-Z]$/.test(e.key)) { flashKey(e.key.toLowerCase()); handleKey(e.key.toLowerCase()); }
});

// Poke the bean.
mascot.addEventListener("click", () => {
  if (mascot.dataset.mood === "sad") return;
  const prev = mascot.dataset.mood;
  setMood("giggle", 900);
  if (prev === "happy" || prev === "cheer") setTimeout(() => setMood(prev, 0), 900);
});

// ---- Modals ---------------------------------------------------------------

function closeModals() {
  document.querySelectorAll(".modal").forEach((m) => m.classList.add("hidden"));
}

document.querySelectorAll(".modal").forEach((modal) => {
  modal.addEventListener("click", (e) => {
    if (e.target === modal || e.target.hasAttribute("data-close")) closeModals();
  });
});

document.getElementById("help-btn").addEventListener("click", (e) => { e.currentTarget.blur(); helpModal.classList.remove("hidden"); });
document.getElementById("stats-btn").addEventListener("click", (e) => { e.currentTarget.blur(); openStats(); });

function openStats() {
  document.getElementById("stat-played").textContent = stats.played;
  document.getElementById("stat-win").textContent = stats.played ? Math.round((stats.wins / stats.played) * 100) : 0;
  document.getElementById("stat-streak").textContent = stats.currentStreak;
  document.getElementById("stat-max").textContent = stats.maxStreak;

  const dist = document.getElementById("distribution");
  dist.innerHTML = "";
  const max = Math.max(1, ...stats.distribution);
  stats.distribution.forEach((count, i) => {
    const row = document.createElement("div");
    row.className = "dist-row";
    const highlight = state && state.status === "won" && state.guesses.length === i + 1;
    row.innerHTML = `<span class="label">${i + 1}</span><span class="bar${highlight ? " highlight" : ""}" style="width:${Math.max(7, (count / max) * 100)}%">${count}</span>`;
    dist.appendChild(row);
  });

  const done = !!state && state.status !== "playing" && !!revealed;
  const msg = document.getElementById("result-msg");
  if (done && state.status === "won") msg.textContent = `🫘 You found the bean: ${revealed.toUpperCase()}`;
  else if (done) msg.textContent = `Has-bean! Today's bean was ${revealed.toUpperCase()}`;
  else msg.textContent = "";
  document.getElementById("share-btn").classList.toggle("hidden", !done);
  document.getElementById("countdown").textContent = done ? "🌱 A fresh bean sprouts at 5am (Sydney)" : "";

  statsModal.classList.remove("hidden");
}

document.getElementById("share-btn").addEventListener("click", async () => {
  // Green/yellow keep the familiar colour-blind-friendly contrast; brown squares read as beans.
  const EMOJI = { correct: "🟩", present: "🟨", absent: "🟫" };
  const score = state.status === "won" ? state.guesses.length : "X";
  const lines = [];
  for (const g of state.guesses) lines.push((await puzzle.score(g)).map((s) => EMOJI[s]).join(""));
  const tagline = state.status === "won" ? WIN_MESSAGES[state.guesses.length - 1] : "Has-bean!";
  const url = location.origin + location.pathname;
  const text = `🫘 Beandle ${score}/${MAX_GUESSES} · ${tagline}\n\n${lines.join("\n")}\n\n${url}`;
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied! Go spill the beans 🫘");
  } catch {
    toast("Couldn't copy results");
  }
});

// ---- Startup --------------------------------------------------------------

async function fetchMeta() {
  const res = await fetch("puzzle.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Fetch puzzle.json and its matching feedback table (retrying if a deploy lands in between). */
async function fetchPuzzle() {
  for (let attempt = 0; attempt < 3; attempt++) {
    const meta = await fetchMeta();
    const res = await fetch(`puzzle.bin?${meta.h}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const table = new Uint8Array(await res.arrayBuffer());
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", table));
    const hex = Array.from(digest.subarray(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
    if (hex === meta.h) return { meta, table };
  }
  throw new Error("Puzzle files don't match");
}

async function start() {
  if (!isSupported()) {
    toast("Beandle needs to be served over http(s) — see the README", 0);
    return;
  }
  try {
    const { meta, table } = await fetchPuzzle();
    puzzle = await openPuzzle(meta, table);
  } catch {
    toast("Couldn't load today's bean. Try refreshing.", 0);
    return;
  }

  const saved = load(STATE_KEY, null);
  state = saved && saved.puzzleId === puzzle.id
    ? saved
    : { puzzleId: puzzle.id, guesses: [], status: "playing" };

  const restored = [];
  for (const g of state.guesses) restored.push(await puzzle.score(g));
  if (restored.some((r) => !r)) {
    state = { puzzleId: puzzle.id, guesses: [], status: "playing" };
  } else {
    for (let r = 0; r < restored.length; r++) await paintRow(r, state.guesses[r], restored[r], false);
  }
  if (state.status === "won") {
    revealed = state.guesses[state.guesses.length - 1];
    rows[state.guesses.length - 1].el.classList.add("win");
    setMood("happy", 0);
  } else if (state.status === "lost") {
    revealed = await puzzle.reveal();
    setMood("sad", 0);
  }
  renderCurrent();
  busy = false;

  if (state.status !== "playing") {
    setTimeout(openStats, 300);
  } else if (!localStorage.getItem(HELP_KEY)) {
    helpModal.classList.remove("hidden");
    try { localStorage.setItem(HELP_KEY, "1"); } catch { /* ignore */ }
  }

  // If the word changes while the tab is open, start the new game when the player comes back.
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState !== "visible" || busy) return;
    try {
      const latest = await fetchMeta();
      if (latest.id !== puzzle.id) location.reload();
    } catch {
      /* offline; keep playing */
    }
  });
}

start();
