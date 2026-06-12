#!/usr/bin/env node
/**
 * Cotton Eyed Joe — dataset builder (one-time offline step).
 *
 * Fetches club-membership rows from Wikidata (CC0), applies the cleaning
 * rules below, and emits CANDIDATE entries for players.js as JSON. The
 * output is a starting point for manual review — every candidate must be
 * spot-checked before being promoted into players.js, and its photo must
 * be audited for the photoNeutral rule (no featured-club kit/crest).
 *
 * Usage:
 *   node tools/build_players.mjs > candidates.json
 *   node tools/build_players.mjs --featured-club "Arsenal" > arsenal.json
 *
 * Cleaning rules (where automated transfer data goes wrong):
 *  - rows with a blank start date can't be ordered -> player flagged, not guessed
 *  - national teams masquerade as clubs (P54 includes them) -> filtered out
 *  - loan spells appear as separate memberships; short overlapping spells
 *    are flagged rather than trusted
 *  - youth/reserve teams clutter careers -> filtered out
 */

import { readFileSync } from "node:fs";

const ENDPOINT = "https://query.wikidata.org/sparql";
const USER_AGENT = "CottonEyedJoeDatasetBuilder/1.0 (one-time offline build)";

// ---- filters -------------------------------------------------------------

// National teams: P54 doesn't distinguish them from clubs.
const NATIONAL_RE =
  /\bnational\b|\bnational (football|soccer) team\b|\bolympic\b|under-\d+|\bU-?\d{2}\b/i;

// Youth / reserve sides.
const YOUTH_RE = /\byouth\b|\bjuniors?\b$|\bacademy\b|\bprimavera\b|\bjuvenil\b|\breserves?\b|\bB$| II$|\bU\d{2}\b/;

// Looks-like-a-country fallback (labels such as "Brazil" or "France national...").
const COUNTRYISH_RE = /^(?:[A-Z][a-z]+(?: [A-Z][a-z]+)?)$/;
const COUNTRIES = new Set([
  "Brazil","France","Italy","Spain","Germany","England","Argentina","Portugal",
  "Netherlands","Belgium","Croatia","Uruguay","Mexico","Sweden","Denmark","Poland",
  "Wales","Scotland","Ireland","Norway","Japan","South Korea","Nigeria","Ghana",
  "Cameroon","Senegal","Egypt","Morocco","Colombia","Chile","Peru","Ecuador",
  "United States","Canada","Australia","Austria","Switzerland","Czech Republic",
  "Slovakia","Hungary","Romania","Bulgaria","Serbia","Ukraine","Russia","Turkey",
  "Greece","Georgia","Guinea","Ivory Coast","Algeria","Tunisia","Bosnia and Herzegovina",
]);

const isNationalTeam = (label) =>
  NATIONAL_RE.test(label) || COUNTRIES.has(label) || (COUNTRYISH_RE.test(label) && COUNTRIES.has(label));
const isYouthTeam = (label) => YOUTH_RE.test(label);

// ---- fetch ----------------------------------------------------------------

async function fetchRows() {
  const query = readFileSync(new URL("./wikidata_query.sparql", import.meta.url), "utf8")
    .split("\n").filter((l) => !l.trimStart().startsWith("#")).join("\n");
  const url = ENDPOINT + "?format=json&query=" + encodeURIComponent(query);
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/sparql-results+json" } });
  if (!res.ok) throw new Error(`SPARQL request failed: HTTP ${res.status}`);
  const data = await res.json();
  return data.results.bindings.map((b) => ({
    player: b.player?.value,
    name: b.playerLabel?.value,
    club: b.clubLabel?.value,
    start: b.start?.value ?? null,
    end: b.end?.value ?? null,
    image: b.image?.value ?? null,
  }));
}

// ---- post-processing -------------------------------------------------------

function overlap(a, b) {
  if (!a.start || !a.end || !b.start) return false;
  return b.start < a.end;
}

function buildCandidates(rows, featuredClubFilter) {
  const byPlayer = new Map();
  for (const r of rows) {
    if (!byPlayer.has(r.player)) byPlayer.set(r.player, { name: r.name, image: r.image, spells: [] });
    byPlayer.get(r.player).spells.push(r);
  }

  const candidates = [];
  for (const [, p] of byPlayer) {
    const flags = [];

    // Rule: national teams are not clubs.
    let spells = p.spells.filter((s) => s.club && !isNationalTeam(s.club));
    // Rule: youth/reserve teams are excluded.
    const dropped = spells.filter((s) => isYouthTeam(s.club));
    if (dropped.length) flags.push(`excluded youth/reserve: ${dropped.map((s) => s.club).join(", ")}`);
    spells = spells.filter((s) => !isYouthTeam(s.club));

    // De-duplicate identical club+start rows (multiple image bindings etc.).
    const seen = new Set();
    spells = spells.filter((s) => {
      const k = s.club + "|" + s.start;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    // Rule: blank start dates can't be ordered — flag, never guess.
    if (spells.some((s) => !s.start)) {
      flags.push("blank start date(s): needs manual ordering");
    }
    spells.sort((a, b) => (a.start || "").localeCompare(b.start || ""));

    // Rule: overlapping spells are usually loans — flag them.
    for (let i = 1; i < spells.length; i++) {
      if (overlap(spells[i - 1], spells[i])) {
        flags.push(`overlap (possible loan): ${spells[i - 1].club} / ${spells[i].club}`);
      }
    }

    // Need before + featured + after.
    if (spells.length < 3) continue;

    // Featured pick: the longest middle spell (heuristic — review manually).
    let best = -1, bestLen = -1;
    for (let i = 1; i < spells.length - 1; i++) {
      const s = spells[i];
      if (featuredClubFilter && s.club !== featuredClubFilter) continue;
      const len = s.start && s.end ? Date.parse(s.end) - Date.parse(s.start) : 0;
      if (len > bestLen) { bestLen = len; best = i; }
    }
    if (best < 1) continue;

    candidates.push({
      id: p.name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-"),
      name: p.name,
      category: "REVIEW: assign category",
      featuredClub: spells[best].club,
      fromClub: spells[best - 1].club,
      toClub: spells[best + 1].club,
      photoUrl: p.image, // audit before use! must NOT show the featured club's kit
      photoNeutral: false, // stays false until a human checks the image
      altSpellings: { fromClub: [], toClub: [] },
      flags,
    });
  }
  return candidates;
}

// ---- main -------------------------------------------------------------------

const featuredArg = process.argv.indexOf("--featured-club");
const featuredClub = featuredArg > -1 ? process.argv[featuredArg + 1] : null;

const rows = await fetchRows();
const candidates = buildCandidates(rows, featuredClub);
process.stdout.write(JSON.stringify(candidates, null, 2) + "\n");
process.stderr.write(`${candidates.length} candidates (every one needs manual review)\n`);
