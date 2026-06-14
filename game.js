/* Cotton Eyed Joe — game engine.
   Plain vanilla JS, no dependencies. Reads PLAYERS from players.js and
   COTTON_CONFIG from config.js. */

(() => {
  "use strict";

  const ROUND_SIZE = 10;
  const MIX_CATEGORY = "Mix / Random";
  const SUGGESTION_LIMIT = 8;
  const STORE_KEY = "cottonEyedJoe.v2";
  const LOCAL_LB_KEY = "cottonEyedJoe.lb";

  // ---------- data derived from players.js ----------

  const CATEGORIES = [...new Set(PLAYERS.map((p) => p.category))];
  const PLAYERS_BY_ID = new Map(PLAYERS.map((p) => [p.id, p]));

  // Autocomplete pool: every club name appearing anywhere in the dataset.
  const CLUB_POOL = [...new Set(PLAYERS.flatMap((p) => [p.featuredClub, p.fromClub, p.toClub]))]
    .sort((a, b) => a.localeCompare(b));

  // ---------- answer matching ----------

  function normalize(s) {
    return s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/ø/g, "o")
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function isCorrect(guess, club, alts) {
    const g = normalize(guess);
    if (!g) return false;
    return [club, ...(alts || [])].some((c) => normalize(c) === g);
  }

  // ---------- profanity filter ----------

  const BANNED = [
    "anal","anus","arse","ass","bastard","bitch","bollock","boner","boob",
    "cock","coon","crap","cunt","dick","dildo","dyke","fag","faggot","fuck",
    "goddamn","handjob","jizz","kike","knob","labia","muff","nazi","nigga",
    "nigger","nonce","paki","penis","piss","prick","pussy","queer","rape",
    "rapist","retard","scrotum","semen","sex","shit","slut","spastic","spic",
    "tit","tits","titties","turd","twat","vagina","wank","whore",
  ];
  // Safe to match even as a substring (won't appear inside innocent names, so
  // e.g. "Scunthorpe" stays allowed because "cunt" is NOT in this list).
  const SUBSTR = [
    "fuck","shit","faggot","nigger","nigga","bastard","bollock","wank",
    "dildo","jizz","handjob","whore","bitch","pussy","slut","twat","retard",
  ];
  const LEET = { "0":"o","1":"i","3":"e","4":"a","5":"s","7":"t","8":"b","@":"a","$":"s","!":"i" };

  function isProfane(name) {
    const deleet = name.toLowerCase().replace(/[013457@$!8]/g, (c) => LEET[c] || c);
    const collapsed = deleet.replace(/[^a-z]/g, "");        // spaces/punct removed
    const tokens = deleet.replace(/[^a-z]+/g, " ").trim().split(" ").filter(Boolean);
    for (const w of BANNED) {
      if (tokens.includes(w)) return true;                  // whole word
      if (collapsed === w) return true;                     // spaced out, e.g. "f u c k"
    }
    for (const w of SUBSTR) if (collapsed.includes(w)) return true; // embedded, e.g. "fuckface"
    return false;
  }

  // ---------- persistence ----------

  const blankStore = () => ({
    name: "",
    answeredPlayers: {},   // id -> { from:bool|null, to:bool|null, date }
    categories: {},        // category -> { played, best, lastDate }
    daily: {},             // dayKey -> { score,total,accuracy,streak,submitted,results,done }
    stats: { gamesPlayed: 0, totalAnswered: 0, totalCorrect: 0, bestStreakEver: 0 },
  });

  function loadStore() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return blankStore();
      return Object.assign(blankStore(), JSON.parse(raw));
    } catch {
      return blankStore();
    }
  }

  function saveStore() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch { /* storage may be unavailable; game still works in-memory */ }
  }

  const store = loadStore();

  // ---------- daily ----------

  function dayKey(d = new Date()) {
    return d.toISOString().slice(0, 10); // UTC date, same for everyone
  }

  function hashSeed(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function seededShuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Day number since epoch, used to rotate the daily category.
  function dayNumber(key) {
    return Math.floor(Date.parse(key + "T00:00:00Z") / 86400000);
  }

  function dailyCategory(key) {
    return CATEGORIES[dayNumber(key) % CATEGORIES.length];
  }

  function dailySet(key) {
    const cat = dailyCategory(key);
    let pool = PLAYERS.filter((p) => p.category === cat);
    if (pool.length < ROUND_SIZE) pool = PLAYERS.slice();
    const rng = mulberry32(hashSeed("cotton:" + key));
    return seededShuffle(pool, rng).slice(0, ROUND_SIZE);
  }

  // ---------- state ----------

  const state = {
    mode: "category",   // "daily" | "category" | "mix"
    category: null,
    dayKey: null,
    scored: false,      // only daily counts toward the leaderboard
    queue: [],
    index: 0,
    phase: "from",
    score: 0,
    answered: 0,
    streak: 0,
    bestStreak: 0,
    results: [],
    locked: false,
  };

  // ---------- elements ----------

  const $ = (id) => document.getElementById(id);
  const screens = {
    menu: $("screen-menu"),
    game: $("screen-game"),
    summary: $("screen-summary"),
    leaderboard: $("screen-leaderboard"),
  };
  const els = {
    dailyCard: $("daily-card"),
    dailyKicker: $("daily-kicker"),
    dailyStatus: $("daily-status"),
    dailyCat: $("daily-cat"),
    dailySub: $("daily-sub"),
    dailyReset: $("daily-reset"),
    menuStats: $("menu-stats"),
    openLeaderboard: $("open-leaderboard"),
    categoryList: $("category-list"),
    hudCategory: $("hud-category"),
    hudProgress: $("hud-progress"),
    hudScore: $("hud-score"),
    hudStreak: $("hud-streak"),
    photo: $("player-photo"),
    photoFallback: $("photo-fallback"),
    seenNote: $("seen-note"),
    playerName: $("player-name"),
    featuredLine: $("featured-line"),
    question: $("question"),
    form: $("answer-form"),
    input: $("answer-input"),
    suggestions: $("suggestions"),
    submitBtn: $("submit-btn"),
    feedback: $("feedback"),
    feedbackText: $("feedback-text"),
    nextBtn: $("next-btn"),
    quitBtn: $("quit-btn"),
    sumTitle: $("sum-title"),
    sumScore: $("sum-score"),
    sumAccuracy: $("sum-accuracy"),
    sumStreak: $("sum-streak"),
    sumVerdict: $("sum-verdict"),
    submitBox: $("submit-box"),
    submitLabel: $("submit-label"),
    nameInput: $("name-input"),
    submitScore: $("submit-score"),
    submitMsg: $("submit-msg"),
    sumList: $("sum-list"),
    againBtn: $("again-btn"),
    viewLbBtn: $("view-lb-btn"),
    menuBtn: $("menu-btn"),
    lbTabs: document.querySelectorAll(".lb-tab"),
    lbNote: $("lb-note"),
    lbList: $("lb-list"),
    lbBack: $("lb-back"),
  };

  function showScreen(name) {
    Object.entries(screens).forEach(([k, el]) => el.classList.toggle("hidden", k !== name));
  }

  // ---------- menu ----------

  // Live "resets in Xh Ym" countdown to the next UTC midnight (when the daily
  // automatically rolls over to a new category + player set).
  function msToNextUtcMidnight() {
    const n = new Date();
    return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 1) - n.getTime();
  }
  function updateDailyCountdown() {
    if (!els.dailyReset) return;
    const ms = msToNextUtcMidnight();
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    els.dailyReset.textContent = `New challenge in ${h}h ${m}m · resets 00:00 UTC`;
  }

  function renderMenu() {
    const today = dayKey();
    const cat = dailyCategory(today);
    // Show today's date so it's clear the challenge is dated and rotates daily.
    const dateLabel = new Date().toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
    els.dailyKicker.textContent = `Daily Challenge · ${dateLabel}`;
    updateDailyCountdown();
    els.dailyCat.textContent = cat;
    const d = store.daily[today];
    if (d && d.done) {
      els.dailyStatus.textContent = `✓ Done — ${d.score}/${d.total}`;
      els.dailyStatus.classList.add("done");
      els.dailySub.textContent = "Tap to review today's result";
    } else {
      els.dailyStatus.textContent = "Play";
      els.dailyStatus.classList.remove("done");
      els.dailySub.textContent = "10 footballers · new every day · scored";
    }

    // overall stats pills
    const s = store.stats;
    const acc = s.totalAnswered ? Math.round((s.totalCorrect / s.totalAnswered) * 100) : 0;
    const seen = Object.keys(store.answeredPlayers).length;
    els.menuStats.innerHTML = "";
    const pill = (html) => {
      const span = document.createElement("span");
      span.className = "ms-pill";
      span.innerHTML = html;
      els.menuStats.appendChild(span);
    };
    pill(`Games <strong>${s.gamesPlayed}</strong>`);
    pill(`Accuracy <strong>${acc}%</strong>`);
    pill(`Best streak <strong>${s.bestStreakEver}</strong>`);
    pill(`Players seen <strong>${seen}/${PLAYERS.length}</strong>`);

    // category cards
    els.categoryList.innerHTML = "";
    const makeCard = (label, count, isMix) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "category-card" + (isMix ? " mix" : "");
      const rec = store.categories[label];
      const best = rec ? `<span class="cat-best">Best ${rec.best}/${count * 2} · played ${rec.played}×</span>` : "";
      btn.innerHTML = `<span class="cat-name"></span><span class="cat-count"></span>${best}`;
      btn.querySelector(".cat-name").textContent = label;
      btn.querySelector(".cat-count").textContent = `${count} footballers`;
      btn.addEventListener("click", () => startRound(isMix ? "mix" : "category", label));
      els.categoryList.appendChild(btn);
    };
    for (const c of CATEGORIES) makeCard(c, PLAYERS.filter((p) => p.category === c).length, false);
    makeCard(MIX_CATEGORY, PLAYERS.length, true);
  }

  // ---------- round flow ----------

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function startDaily() {
    const today = dayKey();
    const d = store.daily[today];
    if (d && d.done) return reviewDaily(today); // already played: review, don't re-score
    state.mode = "daily";
    state.scored = true;
    state.dayKey = today;
    state.category = dailyCategory(today);
    state.queue = dailySet(today);
    beginRound();
  }

  function startRound(mode, category) {
    state.mode = mode;
    state.scored = false;
    state.dayKey = null;
    state.category = category;
    const pool = mode === "mix" ? PLAYERS : PLAYERS.filter((p) => p.category === category);
    state.queue = shuffle(pool).slice(0, ROUND_SIZE);
    beginRound();
  }

  function beginRound() {
    state.index = 0;
    state.phase = "from";
    state.score = 0;
    state.answered = 0;
    state.streak = 0;
    state.bestStreak = 0;
    state.results = state.queue.map((p) => ({ player: p, fromOk: null, toOk: null }));
    showScreen("game");
    renderQuestion();
  }

  const currentPlayer = () => state.queue[state.index];

  function renderHud() {
    els.hudCategory.textContent = state.mode === "daily" ? `Daily · ${state.category}` : state.category;
    els.hudProgress.textContent = `Player ${state.index + 1} / ${state.queue.length}`;
    els.hudScore.textContent = `Score ${state.score} / ${state.queue.length * 2}`;
    els.hudStreak.textContent = `Streak ${state.streak}${state.streak >= 3 ? " 🔥" : ""}`;
  }

  // Wikipedia REST fallback: resolves a player's lead image by article title.
  // Used for entries that carry a `wiki` field (no curated Commons file). The
  // promise per title is cached so we never refetch within a session.
  const wikiCache = new Map();
  function resolveWiki(title) {
    if (wikiCache.has(title)) return wikiCache.get(title);
    const url = "https://en.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(title.replace(/ /g, "_"));
    const promise = fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => (d && ((d.thumbnail && d.thumbnail.source) || (d.originalimage && d.originalimage.source))) || null)
      .catch(() => null);
    wikiCache.set(title, promise);
    return promise;
  }

  let photoToken = 0; // guards against a slow image arriving after we moved on

  function renderPhoto(p) {
    const token = ++photoToken;
    els.photo.classList.add("hidden");
    els.photo.removeAttribute("src");
    els.photoFallback.classList.remove("hidden");
    els.photoFallback.textContent = p.name.split(/\s+/).map((w) => w[0]).slice(0, 3).join("").toUpperCase();

    const show = (url) => {
      if (!url || token !== photoToken) return;
      els.photo.alt = p.name;
      els.photo.onload = () => { if (token === photoToken) { els.photo.classList.remove("hidden"); els.photoFallback.classList.add("hidden"); } };
      els.photo.onerror = () => { els.photo.classList.add("hidden"); els.photoFallback.classList.remove("hidden"); };
      els.photo.src = url;
    };

    if (p.photoUrl) show(p.photoUrl);          // curated, kit-neutral Commons file
    else if (p.wiki) resolveWiki(p.wiki).then(show); // resolved from Wikipedia
  }

  function renderSeenNote(p) {
    const rec = store.answeredPlayers[p.id];
    if (!rec) { els.seenNote.classList.add("hidden"); return; }
    const f = rec.from === true ? "✓" : rec.from === false ? "✗" : "–";
    const t = rec.to === true ? "✓" : rec.to === false ? "✗" : "–";
    els.seenNote.textContent = `Seen before · last time: from ${f} · to ${t}`;
    els.seenNote.classList.remove("hidden");
  }

  function renderQuestion() {
    const p = currentPlayer();
    renderHud();
    if (state.phase === "from") { renderPhoto(p); renderSeenNote(p); }
    els.playerName.textContent = p.name;
    els.featuredLine.innerHTML = "";
    const strong = document.createElement("strong");
    strong.textContent = p.featuredClub;
    els.featuredLine.append("Featured spell: ", strong);
    els.question.textContent = state.phase === "from"
      ? "Where did you come from? — which club did they join " + p.featuredClub + " from?"
      : "Where did you go? — which club did they join after leaving " + p.featuredClub + "?";
    els.feedback.classList.add("hidden");
    els.feedback.classList.remove("good", "bad");
    els.form.classList.remove("hidden");
    els.input.value = "";
    els.input.disabled = false;
    els.submitBtn.disabled = false;
    state.locked = false;
    hideSuggestions();
    els.input.focus();
  }

  // ---------- autocomplete ----------

  let activeSuggestion = -1;

  function hideSuggestions() {
    els.suggestions.classList.add("hidden");
    els.suggestions.innerHTML = "";
    activeSuggestion = -1;
  }

  function renderSuggestions() {
    const q = normalize(els.input.value);
    if (!q) return hideSuggestions();
    const matches = CLUB_POOL.filter((c) => normalize(c).includes(q)).slice(0, SUGGESTION_LIMIT);
    if (matches.length === 0) return hideSuggestions();
    els.suggestions.innerHTML = "";
    matches.forEach((club) => {
      const li = document.createElement("li");
      li.textContent = club;
      li.setAttribute("role", "option");
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        els.input.value = club;
        hideSuggestions();
        els.input.focus();
      });
      els.suggestions.appendChild(li);
    });
    activeSuggestion = -1;
    els.suggestions.classList.remove("hidden");
  }

  function moveSuggestion(delta) {
    const items = [...els.suggestions.children];
    if (items.length === 0) return;
    activeSuggestion = (activeSuggestion + delta + items.length) % items.length;
    items.forEach((li, i) => li.classList.toggle("active", i === activeSuggestion));
  }

  els.input.addEventListener("input", () => { if (!state.locked) renderSuggestions(); });
  els.input.addEventListener("keydown", (e) => {
    const open = !els.suggestions.classList.contains("hidden");
    if (e.key === "ArrowDown" && open) { e.preventDefault(); moveSuggestion(1); }
    else if (e.key === "ArrowUp" && open) { e.preventDefault(); moveSuggestion(-1); }
    else if (e.key === "Enter" && open && activeSuggestion >= 0) {
      e.preventDefault();
      els.input.value = els.suggestions.children[activeSuggestion].textContent;
      hideSuggestions();
    } else if (e.key === "Escape") hideSuggestions();
  });
  document.addEventListener("click", (e) => {
    if (!els.suggestions.contains(e.target) && e.target !== els.input) hideSuggestions();
  });

  // ---------- answering ----------

  function recordAnswer(p, phase, ok) {
    const rec = store.answeredPlayers[p.id] || { from: null, to: null };
    rec[phase] = ok;
    rec.date = dayKey();
    store.answeredPlayers[p.id] = rec;
    store.stats.totalAnswered++;
    if (ok) store.stats.totalCorrect++;
  }

  els.form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (state.locked) return;
    const guess = els.input.value.trim();
    if (!guess) return;
    const p = currentPlayer();
    const club = state.phase === "from" ? p.fromClub : p.toClub;
    const alts = state.phase === "from" ? p.altSpellings.fromClub : p.altSpellings.toClub;
    const ok = isCorrect(guess, club, alts);

    state.answered++;
    const result = state.results[state.index];
    if (state.phase === "from") result.fromOk = ok; else result.toOk = ok;

    if (ok) { state.score++; state.streak++; state.bestStreak = Math.max(state.bestStreak, state.streak); }
    else state.streak = 0;

    recordAnswer(p, state.phase, ok);
    saveStore();

    state.locked = true;
    els.input.disabled = true;
    els.submitBtn.disabled = true;
    hideSuggestions();
    renderHud();

    els.feedback.classList.remove("hidden", "good", "bad");
    els.feedback.classList.add(ok ? "good" : "bad");
    els.feedbackText.textContent = ok
      ? `✅ Correct! ${p.name} ${state.phase === "from" ? "came from" : "went to"} ${club}.`
      : `❌ Not quite — it was ${club}.`;
    const last = state.phase === "to" && state.index === state.queue.length - 1;
    els.nextBtn.textContent = last ? "See results" : "Next";
    els.nextBtn.focus();
  });

  els.nextBtn.addEventListener("click", () => {
    if (state.phase === "from") { state.phase = "to"; renderQuestion(); }
    else if (state.index < state.queue.length - 1) { state.index++; state.phase = "from"; renderQuestion(); }
    else finishRound();
  });

  els.quitBtn.addEventListener("click", () => { renderMenu(); showScreen("menu"); });

  // ---------- summary ----------

  function verdictFor(pct) {
    if (pct === 100) return "Perfect round — encyclopaedic. 🏆";
    if (pct >= 80) return "Top scout material.";
    if (pct >= 60) return "Solid — you know your transfers.";
    if (pct >= 40) return "Decent, but the window got away from you.";
    return "Where did YOU come from? Time to hit the archives.";
  }

  function finishRound() {
    const total = state.queue.length * 2;

    // personal stats + category memory
    store.stats.gamesPlayed++;
    store.stats.bestStreakEver = Math.max(store.stats.bestStreakEver, state.bestStreak);
    if (state.mode !== "daily") {
      const rec = store.categories[state.category] || { played: 0, best: 0 };
      rec.played++;
      rec.best = Math.max(rec.best, state.score);
      rec.lastDate = dayKey();
      store.categories[state.category] = rec;
    } else {
      store.daily[state.dayKey] = {
        score: state.score, total,
        accuracy: total ? Math.round((state.score / total) * 100) : 0,
        streak: state.bestStreak,
        submitted: false,
        done: true,
        results: state.results.map((r) => ({ id: r.player.id, fromOk: r.fromOk, toOk: r.toOk })),
      };
    }
    saveStore();
    renderSummary(false);
  }

  function renderSummary(isReview) {
    const total = state.queue.length * 2;
    const pct = total ? Math.round((state.score / total) * 100) : 0;
    els.sumTitle.textContent = state.mode === "daily"
      ? (isReview ? "Today's Daily" : "Daily complete!")
      : "Full time!";
    els.sumScore.textContent = `${state.score} / ${total}`;
    els.sumAccuracy.textContent = `${pct}%`;
    els.sumStreak.textContent = String(state.bestStreak);
    els.sumVerdict.textContent = verdictFor(pct);

    // submission box: only for the daily challenge
    if (state.mode === "daily") {
      const d = store.daily[state.dayKey];
      els.submitBox.classList.remove("hidden");
      els.nameInput.value = store.name || "";
      if (d && d.submitted) {
        els.submitLabel.textContent = "Submitted to the leaderboard ✓";
        els.nameInput.disabled = true;
        els.submitScore.disabled = true;
        els.submitMsg.textContent = `Posted as “${d.submittedName || store.name}”`;
        els.submitMsg.className = "submit-msg ok";
      } else {
        els.submitLabel.textContent = "Enter a name for the leaderboard";
        els.nameInput.disabled = false;
        els.submitScore.disabled = false;
        els.submitMsg.textContent = "";
        els.submitMsg.className = "submit-msg";
      }
      els.againBtn.classList.add("hidden"); // one scored play per day
    } else {
      els.submitBox.classList.add("hidden");
      els.againBtn.classList.remove("hidden");
    }

    els.sumList.innerHTML = "";
    for (const r of state.results) {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.className = "sum-name";
      name.textContent = `${r.player.name} (${r.player.featuredClub})`;
      const from = document.createElement("span");
      from.className = r.fromOk ? "ok" : "ko";
      from.textContent = `${r.fromOk ? "✓" : "✗"} from ${r.player.fromClub}`;
      const to = document.createElement("span");
      to.className = r.toOk ? "ok" : "ko";
      to.textContent = `${r.toOk ? "✓" : "✗"} to ${r.player.toClub}`;
      li.append(name, from, to);
      els.sumList.appendChild(li);
    }
    showScreen("summary");
  }

  function reviewDaily(key) {
    const d = store.daily[key];
    if (!d) return;
    state.mode = "daily";
    state.dayKey = key;
    state.category = dailyCategory(key);
    state.queue = dailySet(key);
    state.score = d.score;
    state.bestStreak = d.streak;
    state.results = d.results.map((r) => ({ player: PLAYERS_BY_ID.get(r.id), fromOk: r.fromOk, toOk: r.toOk }));
    renderSummary(true);
  }

  els.againBtn.addEventListener("click", () => {
    if (state.mode === "mix") startRound("mix", MIX_CATEGORY);
    else startRound("category", state.category);
  });
  els.menuBtn.addEventListener("click", () => { renderMenu(); showScreen("menu"); });
  els.logoBtn = $("logo-btn");
  els.logoBtn.addEventListener("click", () => { renderMenu(); showScreen("menu"); });
  els.dailyCard.addEventListener("click", startDaily);

  // ---------- leaderboard ----------

  const LB_BASE = (COTTON_CONFIG && COTTON_CONFIG.leaderboardUrl || "").replace(/\/+$/, "");
  const lbRemote = !!LB_BASE;

  function localBoards() {
    try { return JSON.parse(localStorage.getItem(LOCAL_LB_KEY)) || {}; }
    catch { return {}; }
  }
  function saveLocalBoards(b) {
    try { localStorage.setItem(LOCAL_LB_KEY, JSON.stringify(b)); } catch { /* ignore */ }
  }

  async function submitToBoard(entry) {
    if (lbRemote) {
      const res = await fetch(LB_BASE + "/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error === "profanity" ? "profanity" : "network");
      }
      return;
    }
    // local fallback
    const boards = localBoards();
    const sortTrim = (arr) => { arr.sort((a, b) => b.score - a.score || b.accuracy - a.accuracy || a.ts - b.ts); return arr.slice(0, 200); };
    const e = { ...entry, ts: Date.now() };
    const targets = entry.day ? ["daily:" + entry.day, "all"] : ["all"];
    for (const k of targets) { const arr = boards[k] || []; arr.push(e); boards[k] = sortTrim(arr); }
    saveLocalBoards(boards);
  }

  async function fetchBoard(scope, day) {
    if (lbRemote) {
      const url = scope === "daily" ? `${LB_BASE}/?scope=daily&day=${day}` : `${LB_BASE}/?scope=all`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("network");
      const data = await res.json();
      return data.entries || [];
    }
    const boards = localBoards();
    return (scope === "daily" ? boards["daily:" + day] : boards["all"]) || [];
  }

  els.submitScore.addEventListener("click", async () => {
    const name = els.nameInput.value.trim();
    if (!name) { els.submitMsg.textContent = "Please enter a name."; els.submitMsg.className = "submit-msg err"; return; }
    if (isProfane(name)) { els.submitMsg.textContent = "Please choose a different name."; els.submitMsg.className = "submit-msg err"; return; }

    const d = store.daily[state.dayKey];
    const entry = {
      name, score: state.score, total: state.queue.length * 2,
      accuracy: d ? d.accuracy : 0, streak: state.bestStreak,
      mode: `Daily · ${state.category}`, day: state.dayKey,
    };
    els.submitScore.disabled = true;
    els.submitMsg.textContent = "Submitting…";
    els.submitMsg.className = "submit-msg";
    try {
      await submitToBoard(entry);
      store.name = name;
      if (d) { d.submitted = true; d.submittedName = name; }
      saveStore();
      els.submitLabel.textContent = "Submitted to the leaderboard ✓";
      els.nameInput.disabled = true;
      els.submitMsg.textContent = lbRemote ? "Posted!" : "Saved locally (set a Worker URL for a global board).";
      els.submitMsg.className = "submit-msg ok";
    } catch (err) {
      els.submitScore.disabled = false;
      els.submitMsg.textContent = err.message === "profanity"
        ? "Please choose a different name."
        : "Couldn't reach the leaderboard. Try again.";
      els.submitMsg.className = "submit-msg err";
    }
  });

  let lbScope = "daily";
  async function openLeaderboard(scope = "daily") {
    lbScope = scope;
    els.lbTabs.forEach((t) => t.classList.toggle("active", t.dataset.scope === scope));
    els.lbList.innerHTML = "";
    els.lbNote.textContent = lbRemote ? "Global leaderboard" : "Local leaderboard (this device) — deploy the Worker for a global board.";
    showScreen("leaderboard");
    const today = dayKey();
    try {
      const entries = await fetchBoard(scope, today);
      if (!entries.length) {
        els.lbList.innerHTML = `<div class="lb-empty">No scores yet${scope === "daily" ? " today" : ""}. Be the first!</div>`;
        return;
      }
      for (const e of entries) {
        const li = document.createElement("li");
        const name = document.createElement("span");
        name.className = "lb-name";
        name.textContent = e.name;
        const meta = document.createElement("span");
        meta.className = "lb-meta";
        meta.textContent = scope === "all" && e.mode ? ` ${e.mode}` : ` ${e.accuracy}%`;
        name.appendChild(meta);
        const score = document.createElement("span");
        score.className = "lb-score";
        score.textContent = `${e.score}/${e.total || 20}`;
        li.append(name, score);
        els.lbList.appendChild(li);
      }
    } catch {
      els.lbList.innerHTML = `<div class="lb-empty">Couldn't load the leaderboard. Check your connection.</div>`;
    }
  }

  els.openLeaderboard.addEventListener("click", () => openLeaderboard("daily"));
  els.viewLbBtn.addEventListener("click", () => openLeaderboard(state.mode === "daily" ? "daily" : "all"));
  els.lbTabs.forEach((t) => t.addEventListener("click", () => openLeaderboard(t.dataset.scope)));
  els.lbBack.addEventListener("click", () => { renderMenu(); showScreen("menu"); });

  // ---------- boot ----------

  renderMenu();
  showScreen("menu");
  setInterval(updateDailyCountdown, 30000); // keep the "resets in" line live

  // expose a little for the smoke test (no effect in the browser UI)
  window.__CEJ__ = { normalize, isCorrect, isProfane, dailySet, dailyCategory, dayKey, CATEGORIES, store };
})();
