/* Cotton Eyed Joe — game engine.
   Plain vanilla JS, no dependencies. Reads the PLAYERS array from players.js. */

(() => {
  "use strict";

  const ROUND_SIZE = 10;
  const MIX_CATEGORY = "Mix / Random";
  const SUGGESTION_LIMIT = 8;

  // ---------- data derived from players.js ----------

  // Categories are read from the data, never hardcoded.
  const CATEGORIES = [...new Set(PLAYERS.map((p) => p.category))];

  // Autocomplete pool: every club name appearing anywhere in the dataset.
  const CLUB_POOL = [...new Set(PLAYERS.flatMap((p) => [p.featuredClub, p.fromClub, p.toClub]))]
    .sort((a, b) => a.localeCompare(b));

  // ---------- answer matching ----------

  // Case-, accent- and punctuation-insensitive comparison.
  function normalize(s) {
    return s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
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

  // ---------- state ----------

  const state = {
    category: null,
    queue: [],        // players for this round
    index: 0,         // current player
    phase: "from",    // "from" | "to"
    score: 0,
    answered: 0,
    streak: 0,
    bestStreak: 0,
    results: [],      // {player, fromOk, toOk}
    locked: false,    // input locked while feedback is showing
  };

  // ---------- elements ----------

  const $ = (id) => document.getElementById(id);
  const screens = {
    menu: $("screen-menu"),
    game: $("screen-game"),
    summary: $("screen-summary"),
  };
  const els = {
    categoryList: $("category-list"),
    hudCategory: $("hud-category"),
    hudProgress: $("hud-progress"),
    hudScore: $("hud-score"),
    hudStreak: $("hud-streak"),
    photo: $("player-photo"),
    photoFallback: $("photo-fallback"),
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
    sumScore: $("sum-score"),
    sumAccuracy: $("sum-accuracy"),
    sumStreak: $("sum-streak"),
    sumVerdict: $("sum-verdict"),
    sumList: $("sum-list"),
    againBtn: $("again-btn"),
    menuBtn: $("menu-btn"),
    logoBtn: $("logo-btn"),
  };

  function showScreen(name) {
    Object.entries(screens).forEach(([k, el]) => el.classList.toggle("hidden", k !== name));
  }

  // ---------- menu ----------

  function renderMenu() {
    els.categoryList.innerHTML = "";
    const makeCard = (label, count, isMix) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "category-card" + (isMix ? " mix" : "");
      btn.innerHTML =
        `<span class="cat-name"></span><span class="cat-count"></span>`;
      btn.querySelector(".cat-name").textContent = label;
      btn.querySelector(".cat-count").textContent = `${count} footballers`;
      btn.addEventListener("click", () => startRound(label));
      els.categoryList.appendChild(btn);
    };
    for (const cat of CATEGORIES) {
      makeCard(cat, PLAYERS.filter((p) => p.category === cat).length, false);
    }
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

  function startRound(category) {
    const pool = category === MIX_CATEGORY
      ? PLAYERS
      : PLAYERS.filter((p) => p.category === category);
    state.category = category;
    state.queue = shuffle(pool).slice(0, ROUND_SIZE); // no repeats within a round
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

  function currentPlayer() {
    return state.queue[state.index];
  }

  function renderHud() {
    els.hudCategory.textContent = state.category;
    els.hudProgress.textContent = `Player ${state.index + 1} / ${state.queue.length}`;
    els.hudScore.textContent = `Score ${state.score} / ${state.queue.length * 2}`;
    els.hudStreak.textContent = `Streak ${state.streak}${state.streak >= 3 ? " 🔥" : ""}`;
  }

  function renderPhoto(p) {
    els.photo.classList.add("hidden");
    els.photo.removeAttribute("src");
    els.photoFallback.classList.remove("hidden");
    // Initials placeholder is always prepared; the photo replaces it on load.
    els.photoFallback.textContent = p.name
      .split(/\s+/)
      .map((w) => w[0])
      .slice(0, 3)
      .join("")
      .toUpperCase();
    // Only audited photos (photoNeutral) are shown — never risk leaking the kit.
    if (p.photoUrl && p.photoNeutral) {
      els.photo.alt = p.name;
      els.photo.onload = () => {
        els.photo.classList.remove("hidden");
        els.photoFallback.classList.add("hidden");
      };
      els.photo.onerror = () => {
        els.photo.classList.add("hidden");
        els.photoFallback.classList.remove("hidden");
      };
      els.photo.src = p.photoUrl;
    }
  }

  function renderQuestion() {
    const p = currentPlayer();
    renderHud();
    if (state.phase === "from") renderPhoto(p);
    els.playerName.textContent = p.name;
    els.featuredLine.innerHTML = "";
    const strong = document.createElement("strong");
    strong.textContent = p.featuredClub;
    els.featuredLine.append("Featured spell: ", strong);
    els.question.textContent =
      state.phase === "from"
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
    matches.forEach((club, i) => {
      const li = document.createElement("li");
      li.textContent = club;
      li.setAttribute("role", "option");
      li.addEventListener("mousedown", (e) => {
        e.preventDefault(); // keep focus on the input
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

  els.input.addEventListener("input", () => {
    if (!state.locked) renderSuggestions();
  });

  els.input.addEventListener("keydown", (e) => {
    const open = !els.suggestions.classList.contains("hidden");
    if (e.key === "ArrowDown" && open) {
      e.preventDefault();
      moveSuggestion(1);
    } else if (e.key === "ArrowUp" && open) {
      e.preventDefault();
      moveSuggestion(-1);
    } else if (e.key === "Enter" && open && activeSuggestion >= 0) {
      e.preventDefault(); // pick the highlighted suggestion instead of submitting
      els.input.value = els.suggestions.children[activeSuggestion].textContent;
      hideSuggestions();
    } else if (e.key === "Escape") {
      hideSuggestions();
    }
  });

  document.addEventListener("click", (e) => {
    if (!els.suggestions.contains(e.target) && e.target !== els.input) hideSuggestions();
  });

  // ---------- answering ----------

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
    if (state.phase === "from") result.fromOk = ok;
    else result.toOk = ok;

    if (ok) {
      state.score++;
      state.streak++;
      state.bestStreak = Math.max(state.bestStreak, state.streak);
    } else {
      state.streak = 0;
    }

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
    if (state.phase === "from") {
      state.phase = "to";
      renderQuestion();
    } else if (state.index < state.queue.length - 1) {
      state.index++;
      state.phase = "from";
      renderQuestion();
    } else {
      renderSummary();
    }
  });

  // ---------- summary ----------

  function verdictFor(pct) {
    if (pct === 100) return "Perfect round — encyclopaedic. 🏆";
    if (pct >= 80) return "Top scout material.";
    if (pct >= 60) return "Solid — you know your transfers.";
    if (pct >= 40) return "Decent, but the window got away from you.";
    return "Where did YOU come from? Time to hit the archives.";
  }

  function renderSummary() {
    const total = state.queue.length * 2;
    const pct = total ? Math.round((state.score / total) * 100) : 0;
    els.sumScore.textContent = `${state.score} / ${total}`;
    els.sumAccuracy.textContent = `${pct}%`;
    els.sumStreak.textContent = String(state.bestStreak);
    els.sumVerdict.textContent = verdictFor(pct);
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

  els.againBtn.addEventListener("click", () => startRound(state.category));
  els.menuBtn.addEventListener("click", () => showScreen("menu"));
  els.logoBtn.addEventListener("click", () => showScreen("menu"));

  // ---------- boot ----------

  renderMenu();
  showScreen("menu");
})();
