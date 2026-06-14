#!/usr/bin/env node
/**
 * Cotton Eyed Joe — daily player auto-adder (runs in GitHub Actions).
 *
 * Pulls footballers from Wikidata (CC0), builds each one's
 * fromClub/featuredClub/toClub chain with the usual cleaning rules, sorts them
 * into a practice category by the featured club's league, and APPENDS the new
 * ones to players.js. Designed to run once a day on a schedule so the pool —
 * and therefore the daily challenge and practice rounds — keeps growing.
 *
 * NOTE: automated transfer data is imperfect (loans, youth/national teams,
 * blank dates). This adds only players it can build a clean 3-club chain for,
 * but entries are UNVERIFIED — they carry a comment flag and photoNeutral:false.
 *
 * Network (Wikidata) is only touched in main(); the data logic below is pure
 * and unit-tested in tools/daily_add.test.mjs.
 */

import { readFileSync, writeFileSync } from "node:fs";

const PLAYERS_FILE = new URL("../players.js", import.meta.url);
const ENDPOINT = "https://query.wikidata.org/sparql";
const USER_AGENT = "CottonEyedJoeDailyBuilder/1.0 (https://www.footballf.art)";
const ADD_PER_RUN = 10;

// ---- filters (national teams & youth sides masquerade as clubs) ----
const NATIONAL_RE = /\bnational\b|\bolympic\b|under-?\d+|\bU-?\d{2}\b|\bselect XI\b/i;
const YOUTH_RE = /\byouth\b|\bjuniors?\b|\bacademy\b|\bprimavera\b|\bjuvenil\b|\breserves?\b|\bU\d{2}\b|\bII\b|\bB team\b/i;

const COUNTRIES = new Set([
  "Brazil","France","Italy","Spain","Germany","England","Argentina","Portugal",
  "Netherlands","Belgium","Croatia","Uruguay","Mexico","Sweden","Denmark","Poland",
  "Wales","Scotland","Ireland","Norway","Japan","South Korea","Nigeria","Ghana",
  "Cameroon","Senegal","Egypt","Morocco","Colombia","Chile","Peru","Ecuador",
  "United States","Canada","Australia","Austria","Switzerland","Czech Republic",
  "Slovakia","Hungary","Romania","Bulgaria","Serbia","Ukraine","Russia","Turkey",
  "Greece","Georgia","Guinea","Ivory Coast","Algeria","Tunisia","Bosnia and Herzegovina",
]);

const isNationalTeam = (label) => NATIONAL_RE.test(label) || COUNTRIES.has(label);
const isYouthTeam = (label) => YOUTH_RE.test(label);

// ---- league -> category mapping ----
function leagueToCategory(leagueLabel) {
  const l = (leagueLabel || "").toLowerCase();
  if (l.includes("premier league") && !l.includes("scottish")) return "Premier League Legends";
  if (l.includes("la liga") || l.includes("primera divisi")) return "La Liga";
  if (l.includes("serie a")) return "Serie A";
  if (l.includes("bundesliga") && !l.includes("2.")) return "Bundesliga";
  return "Modern Stars"; // catch-all for other leagues
}

function norm(s) {
  return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}
function slug(s) {
  return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function hashSeed(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function seededShuffle(arr, rng) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

/**
 * Pure: turn raw SPARQL rows into clean candidate player objects.
 * rows: [{ player, name, club, league, start, end }]
 * existingNames: Set of normalized names already in the dataset.
 */
export function buildCandidates(rows, existingNames) {
  const byPlayer = new Map();
  for (const r of rows) {
    if (!r.name || /^Q\d+$/.test(r.name)) continue;          // unlabelled
    if (existingNames.has(norm(r.name))) continue;            // already have them
    if (!byPlayer.has(r.player)) byPlayer.set(r.player, { name: r.name, spells: [] });
    byPlayer.get(r.player).spells.push(r);
  }

  const out = [];
  for (const [, p] of byPlayer) {
    // clubs only, sane labels
    let spells = p.spells.filter((s) => s.club && !isNationalTeam(s.club) && !isYouthTeam(s.club));
    if (spells.some((s) => !s.start)) continue;              // blank dates: don't guess ordering
    // de-dup identical club+start
    const seen = new Set();
    spells = spells.filter((s) => { const k = s.club + "|" + s.start; if (seen.has(k)) return false; seen.add(k); return true; });
    spells.sort((a, b) => String(a.start).localeCompare(String(b.start)));
    if (spells.length < 3) continue;
    // skip if any short overlapping (likely loan) spell muddies the order
    let overlap = false;
    for (let i = 1; i < spells.length; i++) {
      if (spells[i - 1].end && spells[i].start < spells[i - 1].end) { overlap = true; break; }
    }
    if (overlap) continue;

    // featured = longest interior spell
    let best = -1, bestLen = -1;
    for (let i = 1; i < spells.length - 1; i++) {
      const s = spells[i];
      const len = s.start && s.end ? Date.parse(s.end) - Date.parse(s.start) : 0;
      if (len > bestLen) { bestLen = len; best = i; }
    }
    if (best < 1) continue;

    const featured = spells[best];
    const fromClub = spells[best - 1].club;
    const toClub = spells[best + 1].club;
    if (fromClub === featured.club || toClub === featured.club) continue;

    out.push({
      id: slug(p.name),
      name: p.name,
      category: leagueToCategory(featured.league),
      featuredClub: featured.club,
      fromClub,
      toClub,
      photoUrl: null,
      photoNeutral: false,
      wiki: p.name,
      altSpellings: { fromClub: [], toClub: [] },
    });
  }
  return out;
}

const js = (v) => JSON.stringify(v);
export function serializeEntry(p, dateStr) {
  let s = "  {\n";
  s += `    id: ${js(p.id)},\n`;
  s += `    name: ${js(p.name)},\n`;
  s += `    category: ${js(p.category)},\n`;
  s += `    featuredClub: ${js(p.featuredClub)},\n`;
  s += `    fromClub: ${js(p.fromClub)},\n`;
  s += `    toClub: ${js(p.toClub)},\n`;
  s += `    photoUrl: null,\n`;
  s += `    photoNeutral: false,\n`;
  s += `    wiki: ${js(p.wiki)}, // photo resolved at runtime from Wikipedia\n`;
  if (p.daily) s += `    daily: ${js(p.daily)}, // featured as the daily challenge on this date\n`;
  s += `    altSpellings: { fromClub: [], toClub: [] },\n`;
  s += `    // auto-added ${dateStr} from Wikidata (unverified)\n`;
  s += "  },\n";
  return s;
}

/** Pure: splice new entries into the players.js source before the closing `];`. */
export function appendToSource(src, entries, dateStr) {
  const marker = src.lastIndexOf("];");
  if (marker < 0) throw new Error("players.js: closing ]; not found");
  const block = entries.map((e) => serializeEntry(e, dateStr)).join("");
  return src.slice(0, marker) + block + src.slice(marker);
}

const CAP = 500; // maximum number of players kept in players.js

/**
 * Pure: which player ids to prune to keep the pool at CAP. Removes only
 * auto-added players (those carrying a `daily` tag), oldest first, and never
 * today's set or the hand-verified base (which have no `daily` tag).
 */
export function idsToPrune(players, cap, today) {
  const excess = players.length - cap;
  if (excess <= 0) return [];
  const prunable = players
    .filter((p) => p.daily && p.daily !== today)
    .sort((a, b) => String(a.daily).localeCompare(String(b.daily)));
  return prunable.slice(0, excess).map((p) => p.id);
}

/** Pure: remove the given player object blocks from the players.js source. */
export function pruneSource(src, ids) {
  let out = src;
  for (const id of ids) {
    const needle = `id: ${JSON.stringify(id)},`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp("\\n  \\{\\n    " + needle + "[\\s\\S]*?\\n  \\},", "");
    out = out.replace(re, "");
  }
  return out;
}

// ---- network + write (only runs when executed directly) ----

async function fetchRows() {
  const query = `
    SELECT ?player ?playerLabel ?clubLabel ?leagueLabel ?start ?end WHERE {
      ?player wdt:P106 wd:Q937857 .
      ?player wikibase:sitelinks ?links . FILTER(?links > 50)
      ?player p:P54 ?ms . ?ms ps:P54 ?club .
      OPTIONAL { ?ms pq:P580 ?start. }
      OPTIONAL { ?ms pq:P582 ?end. }
      OPTIONAL { ?club wdt:P118 ?league. }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    ORDER BY ?playerLabel ?start
    LIMIT 6000`;
  const url = ENDPOINT + "?format=json&query=" + encodeURIComponent(query);
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/sparql-results+json" } });
  if (!res.ok) throw new Error("SPARQL HTTP " + res.status);
  const data = await res.json();
  return data.results.bindings.map((b) => ({
    player: b.player?.value,
    name: b.playerLabel?.value,
    club: b.clubLabel?.value,
    league: b.leagueLabel?.value,
    start: b.start?.value ?? null,
    end: b.end?.value ?? null,
  }));
}

async function main() {
  const dateStr = new Date().toISOString().slice(0, 10);
  const src = readFileSync(PLAYERS_FILE, "utf8");
  const PLAYERS = new Function(src + "; return PLAYERS;")();

  // One batch per day: today's batch IS today's daily challenge.
  if (PLAYERS.some((p) => p.daily === dateStr)) {
    console.log(`Today's daily (${dateStr}) is already prepared - no changes.`);
    return;
  }

  const existingNames = new Set(PLAYERS.map((p) => norm(p.name)));
  const existingIds = new Set(PLAYERS.map((p) => p.id));

  let rows;
  try { rows = await fetchRows(); }
  catch (e) { console.error("Wikidata fetch failed:", e.message, "- no changes."); return; }

  let candidates = buildCandidates(rows, existingNames);
  // de-dup ids against existing + within batch
  const used = new Set(existingIds);
  candidates = candidates.filter((c) => { if (!c.id || used.has(c.id)) return false; used.add(c.id); return true; });

  // deterministic daily pick; tag them as THIS day's daily challenge
  const picked = seededShuffle(candidates, mulberry32(hashSeed("cotton-add:" + dateStr))).slice(0, ADD_PER_RUN);
  if (picked.length === 0) { console.log("No new valid players found - no changes."); return; }
  picked.forEach((p) => { p.daily = dateStr; });

  let next = appendToSource(src, picked, dateStr);
  let afterAdd = new Function(next + "; return PLAYERS;")();
  if (afterAdd.length !== PLAYERS.length + picked.length) throw new Error("post-append validation failed");

  // enforce the size cap: prune oldest auto-added players
  const pruneIds = idsToPrune(afterAdd, CAP, dateStr);
  if (pruneIds.length) {
    next = pruneSource(next, pruneIds);
    const afterPrune = new Function(next + "; return PLAYERS;")();
    const expected = afterAdd.length - pruneIds.length;
    if (afterPrune.length !== expected) throw new Error("post-prune validation failed");
  }

  // final safety: every entry still has the required fields
  const finalPlayers = new Function(next + "; return PLAYERS;")();
  for (const p of finalPlayers) {
    if (!p.id || !p.name || !p.category || !p.featuredClub || !p.fromClub || !p.toClub) {
      throw new Error("validation failed: malformed entry " + (p.id || p.name));
    }
  }

  writeFileSync(PLAYERS_FILE, next);
  console.log(`Added ${picked.length} players (${dateStr}); pruned ${pruneIds.length}; pool now ${finalPlayers.length}/${CAP}.`);
  for (const p of picked) console.log(`  + ${p.name} [${p.category}] ${p.fromClub} -> ${p.featuredClub} -> ${p.toClub}`);
}

// run only when invoked directly (not when imported by tests)
if (import.meta.url === `file://${process.argv[1]}`) main();
