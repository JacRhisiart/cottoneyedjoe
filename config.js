/* Cotton Eyed Joe — runtime configuration.
 *
 * leaderboardUrl: the URL of your deployed Cloudflare Worker (see worker/).
 *   Leave it as "" to run with a LOCAL, this-device-only leaderboard.
 *   Once you deploy the Worker, paste its URL here, e.g.:
 *     leaderboardUrl: "https://cottoneyedjoe-leaderboard.yourname.workers.dev"
 *   and the leaderboard becomes global (shared across everyone).
 */
const COTTON_CONFIG = {
  leaderboardUrl: "https://cottoneyedjoe-leaderboard.jacrhisiart1.workers.dev",
};
