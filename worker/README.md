# Cotton Eyed Joe — global leaderboard Worker

A tiny [Cloudflare Worker](https://workers.cloudflare.com/) (free tier) that
stores leaderboard scores in Workers KV. The game works without it (it falls
back to a local, this-device leaderboard); deploy this to make the board
**global** — shared across everyone who plays.

## One-time setup (~5 minutes)

You need a free Cloudflare account and [Wrangler](https://developers.cloudflare.com/workers/wrangler/install-and-update/)
(`npm install -g wrangler`).

```bash
cd worker
wrangler login                              # opens a browser to authorise

# 1. Create the KV namespace and copy the printed id
wrangler kv namespace create LEADERBOARD

# 2. Paste that id into wrangler.toml (replace REPLACE_WITH_KV_ID)

# 3. Deploy
wrangler deploy
```

Wrangler prints your Worker URL, e.g.
`https://cottoneyedjoe-leaderboard.yourname.workers.dev`.

## Wire it into the game

Open `../config.js` and set:

```js
const COTTON_CONFIG = {
  leaderboardUrl: "https://cottoneyedjoe-leaderboard.yourname.workers.dev",
};
```

Commit and push. The leaderboard is now global.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/?scope=all` | top all-time scores |
| `GET` | `/?scope=daily&day=YYYY-MM-DD` | top scores for one daily challenge |
| `POST` | `/` | submit `{ name, score, total, accuracy, streak, mode, day }` |

Names are length-capped and run through a profanity filter on the server as
well as in the browser. Scores are clamped. Each scope keeps the top 200.
