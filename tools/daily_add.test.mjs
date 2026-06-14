// Unit tests for the pure data logic of daily_add.mjs (no network).
// Run: node tools/daily_add.test.mjs
import { buildCandidates, serializeEntry, appendToSource } from "./daily_add.mjs";

let pass = 0;
const ok = (c, m) => { if (!c) throw new Error("FAIL: " + m); console.log("ok -", m); pass++; };

// Mock SPARQL rows: a clean 4-club career, a national-team intruder, a youth side.
const rows = [
  { player: "Q1", name: "Test Player", club: "Ajax", league: "Eredivisie", start: "2008-01-01T00:00:00Z", end: "2011-01-01T00:00:00Z" },
  { player: "Q1", name: "Test Player", club: "Netherlands national football team", league: null, start: "2009-01-01T00:00:00Z", end: "2018-01-01T00:00:00Z" },
  { player: "Q1", name: "Test Player", club: "Arsenal", league: "Premier League", start: "2011-01-01T00:00:00Z", end: "2016-01-01T00:00:00Z" },
  { player: "Q1", name: "Test Player", club: "Juventus", league: "Serie A", start: "2016-01-01T00:00:00Z", end: "2019-01-01T00:00:00Z" },
  // a player we already have -> must be skipped
  { player: "Q2", name: "Thierry Henry", club: "Monaco", league: "Ligue 1", start: "1994-01-01T00:00:00Z" },
  { player: "Q2", name: "Thierry Henry", club: "Arsenal", league: "Premier League", start: "1999-01-01T00:00:00Z", end: "2007-01-01T00:00:00Z" },
  { player: "Q2", name: "Thierry Henry", club: "Barcelona", league: "La Liga", start: "2007-01-01T00:00:00Z" },
  // a player with a blank start date -> skipped (can't order)
  { player: "Q3", name: "Blank Date", club: "Club A", league: "Serie A", start: null },
  { player: "Q3", name: "Blank Date", club: "Club B", league: "Serie A", start: "2010-01-01T00:00:00Z", end: "2012-01-01T00:00:00Z" },
  { player: "Q3", name: "Blank Date", club: "Club C", league: "Serie A", start: "2012-01-01T00:00:00Z" },
];

const existing = new Set(["thierry henry"]);
const cands = buildCandidates(rows, existing);

ok(cands.length === 1, "exactly one clean new candidate (got " + cands.length + ")");
const c = cands[0];
ok(c.name === "Test Player", "candidate is Test Player");
ok(c.fromClub === "Ajax", "fromClub = Ajax (national team filtered out)");
ok(c.featuredClub === "Arsenal", "featuredClub = Arsenal (longest interior spell)");
ok(c.toClub === "Juventus", "toClub = Juventus");
ok(c.category === "Premier League Legends", "category from featured club's league (Premier League)");
ok(c.wiki === "Test Player" && c.photoUrl === null, "uses Wikipedia photo fallback");
ok(c.id === "test-player", "slugged id");
ok(!cands.some((x) => x.name === "Thierry Henry"), "existing player skipped");
ok(!cands.some((x) => x.name === "Blank Date"), "blank-date player skipped");

// category mapping spot checks via synthetic rows
const mk = (league) => buildCandidates([
  { player: "QX", name: "X Y", club: "A", league: "Ligue 1", start: "2000-01-01T00:00:00Z", end: "2002-01-01T00:00:00Z" },
  { player: "QX", name: "X Y", club: "B", league, start: "2002-01-01T00:00:00Z", end: "2008-01-01T00:00:00Z" },
  { player: "QX", name: "X Y", club: "C", league: "Ligue 1", start: "2008-01-01T00:00:00Z", end: "2010-01-01T00:00:00Z" },
], new Set())[0].category;
ok(mk("La Liga") === "La Liga", "La Liga maps");
ok(mk("Serie A") === "Serie A", "Serie A maps");
ok(mk("Bundesliga") === "Bundesliga", "Bundesliga maps");
ok(mk("Eredivisie") === "Modern Stars", "other leagues -> Modern Stars catch-all");

// serialize + append round-trips and stays valid JS
const fakeSrc = "const PLAYERS = [\n  { id: \"a\", name: \"A\" },\n];\n";
const appended = appendToSource(fakeSrc, [c], "2026-06-15");
const arr = new Function(appended + "; return PLAYERS;")();
ok(arr.length === 2, "appendToSource adds one entry and stays parseable");
ok(arr[1].id === "test-player", "appended entry has correct id");
ok(serializeEntry(c, "2026-06-15").includes("auto-added 2026-06-15"), "entry carries auto-added flag");

// daily tag is serialized when present
const tagged = { ...c, daily: "2026-06-15" };
ok(serializeEntry(tagged, "2026-06-15").includes('daily: "2026-06-15"'), "daily tag is serialized");
ok(!serializeEntry(c, "2026-06-15").includes("daily:"), "no daily line when untagged");

console.log(`\nDAILY-ADD TESTS OK — ${pass} checks passed`);
