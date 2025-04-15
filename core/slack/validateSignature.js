// core/slack/validateSignature.js
const crypto = require("crypto");
const { getSlackWorkspaces } = require("./slackWorkspaces");

/**
 * Validiert die Slack-Signatur für eingehende Anfragen
 * @param {Object} req - Express Request-Objekt (mit Headers)
 * @param {string} rawBody - Original-Textkörper der Anfrage
 * @returns {boolean} true = gültig, false = ungültig
 */
function validateSignature(req, rawBody) {
  const timestamp = req.headers["x-slack-request-timestamp"];
  const signature = req.headers["x-slack-signature"];
  if (!timestamp || !signature) return false;

  const baseString = `v0:${timestamp}:${rawBody}`;
  const secrets = getSlackWorkspaces()
    .map(ws => ws.signingSecret)
    .filter(Boolean);

  return secrets.some(secret => {
    const hash = "v0=" + crypto.createHmac("sha256", secret).update(baseString).digest("hex");
    try {
      return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(hash));
    } catch {
      return false;
    }
  });
}

module.exports = { validateSignature };