# Cotton Eyed Joe ⚽

*Where did you come from? Where did you go?*

A static football transfer-knowledge game. Pick a footballer, see their photo and a
featured spell at a club, and answer two questions:

1. **Where did you come from?** — the club they joined the featured club from
2. **Where did you go?** — the club they joined when the featured spell ended

Type your answer (a live autocomplete suggests club names as you type), build a
score and streak, and get a full-time report.

Everything is plain HTML/CSS/vanilla JavaScript — no build step. The dataset is
baked into `players.js`. The only network calls at runtime are optional:
Wikipedia for a handful of player photos, and your leaderboard Worker.

## Features

- **Daily Challenge** — the **10 brand-new players** added that day (see the
  auto-grow Action below) *are* the day's challenge, the same for everyone. They
  drop into the practice categories the following day. One scored attempt per
  day; re-opening shows your result. (Before the Action has run for a given day,
  the daily falls back to a rotating-category selection from the existing pool.)
- **Practice by category** — unscored rounds for any of the six categories or a
  Mix / Random pool.
- **Progress memory** — the game remembers, per device, which players you've
  answered (and whether you got each one right), which categories you've played
  and your best score, plus overall stats. Seen players show a "last time" hint.
- **Global leaderboard** — submit your daily score under a name; view *Today's
  Daily* and *All-time* boards. Backed by a Cloudflare Worker (see below); falls
  back to a local board until you deploy one.
- **Profanity filter** — names are screened in the browser **and** on the Worker
  (leet-speak and spaced-out evasion handled; "Scunthorpe" is fine).
- **Clue-free photos** — never the featured club's kit/crest; freely-licensed
  Wikimedia images, with a Wikipedia fallback so every player shows a picture.

## Play it locally

Any static file server works:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Deploy to GitHub Pages

1. Push this repository to GitHub (files at the repository root).
2. **Settings → Pages → Build and deployment → Deploy from a branch**.
3. Branch **`main`**, folder **`/ (root)`**, **Save**.
4. The game appears at `https://<username>.github.io/<repo>/` within a minute or two.

## Global leaderboard (Cloudflare Worker)

The leaderboard is global once you deploy the included Worker. Until then it
runs in **local mode** (scores saved on the player's own device).

1. Follow `worker/README.md` to deploy `worker/worker.js` (free Cloudflare
   account + `wrangler`; ~5 minutes). It uses Workers KV — no database to run.
2. Put the Worker URL in `config.js`:
   ```js
   const COTTON_CONFIG = {
     leaderboardUrl: "https://cottoneyedjoe-leaderboard.yourname.workers.dev",
   };
   ```
3. Commit and push. Scores are now shared across everyone.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Markup for the menu / round / summary / leaderboard screens |
| `style.css` | All styling; mobile-responsive, no framework |
| `game.js` | Engine: daily mode, rounds, autocomplete, scoring, persistence, leaderboard, profanity |
| `players.js` | The dataset — one object per footballer |
| `config.js` | Your leaderboard Worker URL (empty = local mode) |
| `worker/` | The Cloudflare Worker that stores global scores |
| `tools/` | Offline pipeline for extending the dataset (not used at runtime) |

## The dataset

`players.js` is an array of objects; adding a footballer is appending one:

```js
{
  id: "thierry-henry",
  name: "Thierry Henry",
  category: "Premier League Legends",
  featuredClub: "Arsenal",
  fromClub: "Juventus",
  toClub: "Barcelona",
  photoUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/...?width=600",
  photoNeutral: true,   // true = photo does NOT show the featuredClub's kit/crest
  altSpellings: { fromClub: ["Juve"], toClub: ["Barca", "FC Barcelona"] }
}
```

Categories are read from the data — invent a new `category` string and it
appears on the menu (plus the built-in **Mix / Random**, and it joins the daily
rotation).

### Photos

Images must give no clues, so they never show the featured club's kit/crest —
national-team or portrait shots are preferred, from **freely-licensed Wikimedia
Commons** files served via `Special:FilePath`.

- ~55 players use a curated, audited Commons file (`photoUrl`, `photoNeutral: true`).
- The rest carry a `wiki` field instead; `game.js` resolves their lead image
  from the Wikipedia REST API at runtime, so **every player shows a picture**.
  To pin one of these to a specific Commons file, set its `photoUrl`/`photoNeutral`
  and remove the `wiki` field.

`tools/check_photos.mjs` verifies the static `photoUrl`s still resolve (run it
somewhere with access to `commons.wikimedia.org`).

### Data rules & verification

- `fromClub`/`toClub` are the **senior, permanent** moves adjacent to the
  featured spell. Loan tangles and comebacks are flagged in comments; the game
  uses the common reading. Wayne Rooney / Zico / Rakitić etc. legitimately have
  the same from- and to-club.
- Sources: Wikidata (CC0), Wikipedia / Wikimedia Commons. No Transfermarkt or
  other reuse-restricted sources. The trickiest chains were re-verified online.

### Automatic daily growth (GitHub Action)

`.github/workflows/daily-players.yml` runs `tools/daily_add.mjs` once a day
(00:15 UTC). It pulls footballers from Wikidata, builds each one's
from/featured/to chain with the cleaning rules below, sorts each into a practice
category by the featured club's league, and commits ~10 new players to
`players.js` (which redeploys the site). Those 10 are tagged with the date and
become **that day's daily challenge**; from the next day they join the practice
categories. Runs are idempotent — one batch per day.

The pool is **capped at 500 players**: once a run pushes it over, the oldest
auto-added players are pruned to bring it back to 500. The hand-verified base
(the original players, which have no `daily` tag) and the current day's set are
never pruned.

**These entries are unverified automated data** — they carry an `auto-added`
comment and `photoNeutral: false`, and use the Wikipedia photo fallback. Bad
chains (loans/odd categories) can slip through; the script skips players it
can't build a clean 3-club, non-overlapping, dated chain for, but it does not
guarantee correctness. Edit or delete any that look wrong. To pause it, disable
the workflow in the repo's **Actions** tab.

The pure logic is unit-tested: `node tools/daily_add.test.mjs`.

### Extending toward 100+ players (manual, verified)

`tools/` contains the one-time offline pipeline (needs `query.wikidata.org`):

```bash
node tools/build_players.mjs > candidates.json   # pull + clean Wikidata careers
# review candidates, assign categories, audit photos, move good ones into players.js
node tools/check_photos.mjs                       # confirm photo URLs resolve
```

The cleaning rules handle the classic failure modes of automated transfer data:
blank start dates (flagged), national teams masquerading as clubs (filtered),
overlapping loan spells (flagged), and youth teams (excluded).

## Credits

- Transfer data: [Wikidata](https://www.wikidata.org) (CC0), [Wikipedia](https://en.wikipedia.org)
- Photos: [Wikimedia Commons](https://commons.wikimedia.org) (freely licensed; see each file's page)
- Name: that song you now can't get out of your head. Sorry.
