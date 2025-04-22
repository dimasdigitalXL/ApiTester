// api-tester/core/slack/validateSignature.js

const crypto = require("crypto");
const { getSlackWorkspaces } = require("./slackWorkspaces");

function validateSignature(req, rawBody) {
  const timestamp = req.headers["x-slack-request-timestamp"];
  const slackSig  = req.headers["x-slack-signature"];

  // Abbruch bei fehlenden Headern
  if (!timestamp || !slackSig) return false;

  // Verhindere Replay-Attacken (±5min)
  const fiveMinutes = 60 * 5;
  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > fiveMinutes) {
    console.error("🚨 Slack Request Timestamp zu alt.");
    return false;
  }

  // Prüfe gegen jedes Signing Secret aus all deinen Workspaces
  const workspaces = getSlackWorkspaces();
  for (const { signingSecret } of workspaces) {
    const baseString = `v0:${timestamp}:${rawBody}`;
    const hmac       = crypto.createHmac("sha256", signingSecret);
    hmac.update(baseString);
    const mySig = `v0=${hmac.digest("hex")}`;
    if (
      Buffer.from(mySig, "utf8").length === Buffer.from(slackSig, "utf8").length &&
      crypto.timingSafeEqual(Buffer.from(mySig, "utf8"), Buffer.from(slackSig, "utf8"))
    ) {
      return true;
    }
  }

  console.error("🚨 Keine gültige Signatur gefunden.");
  return false;
}

module.exports = { validateSignature };