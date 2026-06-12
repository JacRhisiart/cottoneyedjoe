#!/usr/bin/env node
/**
 * Verifies that every photoUrl in players.js actually resolves (HTTP 200).
 * Run from the repo root on a machine with access to commons.wikimedia.org:
 *
 *   node tools/check_photos.mjs
 *
 * Broken URLs should be replaced (or set to null so the game shows the
 * initials placeholder). This does NOT audit kit-neutrality — that's a
 * human job; flip photoNeutral to true only after looking at the image.
 */

import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../players.js", import.meta.url), "utf8");
const players = new Function(src + "; return PLAYERS;")();

let bad = 0;
for (const p of players) {
  if (!p.photoUrl) continue;
  try {
    const res = await fetch(p.photoUrl, { method: "HEAD", redirect: "follow" });
    if (!res.ok) {
      bad++;
      console.log(`MISSING (${res.status})  ${p.id}  ${p.photoUrl}`);
    }
  } catch (err) {
    bad++;
    console.log(`ERROR  ${p.id}  ${err.message}`);
  }
}
console.log(bad === 0 ? "All photo URLs resolve." : `${bad} photo URL(s) need attention.`);
