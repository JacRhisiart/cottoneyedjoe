# Cotton Eyed Joe ⚽

*Where did you come from? Where did you go?*

A static football transfer-knowledge game. Each round shows you 10 footballers
and, for each one, a featured spell at a club. You answer two questions:

1. **Where did you come from?** — the club they joined the featured club from
2. **Where did you go?** — the club they joined when the featured spell ended

Type your answer into the box (a live autocomplete suggests club names as you
type), rack up your score and streak, and get a full-time report at the end.

Everything is plain HTML/CSS/vanilla JavaScript — no build step, no backend,
no runtime API calls. The dataset is baked into `players.js`.

## Play it locally

Any static file server works. For example:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

(Opening `index.html` directly from disk also works in most browsers.)

## Deploy to GitHub Pages

1. Push this repository to GitHub (files at the repository root).
2. On GitHub: **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select branch **`main`** and folder **`/ (root)`**, then **Save**.
5. Your game appears at `https://<username>.github.io/<repo>/` within a minute or two.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Markup for the three screens (menu / round / summary) |
| `style.css` | All styling; mobile-responsive, no framework |
| `game.js` | Game engine: rounds, autocomplete, matching, scoring |
| `players.js` | The dataset — one object per footballer |
| `tools/` | Offline pipeline for extending the dataset (not used at runtime) |

## The dataset

`players.js` holds an array of objects; adding a footballer is appending one
object:

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
automatically appears on the menu (plus the built-in **Mix / Random**).

### Data rules

- `fromClub`/`toClub` are the **senior, permanent** moves adjacent to the
  featured spell. Loan tangles (e.g. moves that started as loans) are noted in
  comments inside `players.js`; the game uses the common reading.
- National teams are not clubs; youth/academy moves don't count as a
  `fromClub` (players who came through the featured club's academy aren't
  suitable entries).

### Photo rule (important)

Images must give no clues. Use **only freely-licensed Wikimedia Commons**
files (served via `Special:FilePath`), and prefer national-team or
portrait shots. **Never** use a photo showing the featured club's kit or
crest.

`photoNeutral` exists so images can be audited and swapped:

- `photoNeutral: true` — a human checked the image; the game shows it.
- `photoNeutral: false` — not audited yet (or no photo); the game shows a
  neutral initials placeholder instead, so an unaudited image can never
  leak an answer.

Currently 14 entries have audited neutral photos; several more have a
candidate `photoUrl` stored but flagged `false` pending a look. Everyone
else gets the placeholder until a suitable Commons image is found.

### Sourcing & verification status

- Transfer chains were compiled from well-documented football history and
  cross-checked against Wikipedia-derived sources. The trickiest cases
  (loan tangles, comebacks like Robben→Groningen, and very recent moves
  like Modrić→Milan) were individually re-verified online.
- Sources: Wikidata (CC0), Wikipedia/Wikimedia Commons. No Transfermarkt or
  other reuse-restricted sources.
- Anything with a nuance carries a `// note:` comment in `players.js` rather
  than being silently smoothed over.

### Extending toward 100+ players

`tools/` contains the one-time offline pipeline (requires network access to
`query.wikidata.org`):

```bash
# 1. Pull candidate careers from Wikidata and apply cleaning rules
node tools/build_players.mjs > candidates.json

# 2. Review candidates manually (loans/youth/national-team issues are
#    flagged, never guessed), assign categories, audit photos, then move
#    the good ones into players.js

# 3. Confirm all photo URLs still resolve
node tools/check_photos.mjs
```

The cleaning rules handle the classic failure modes of automated transfer
data: blank start dates (flagged for manual ordering), national teams
masquerading as clubs (filtered), overlapping loan spells (flagged), and
youth teams (excluded).

## Credits

- Transfer data: [Wikidata](https://www.wikidata.org) (CC0) and
  [Wikipedia](https://en.wikipedia.org)
- Photos: [Wikimedia Commons](https://commons.wikimedia.org) (freely licensed;
  see each file's page for author/license)
- Name: that song you now have stuck in your head. Sorry.
