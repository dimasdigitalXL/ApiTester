// api-tester/core/slack/slackReporter/renderHeaderBlock.js

/**
 * Generiert die Kopfzeile für den Slack API-Testbericht.
 * @param {string} [dateStr] - Datum im Format "dd.mm.yyyy"
 * @returns {Array} Slack Block Kit Header-Blöcke
 */
function renderHeaderBlock(dateStr) {
  const formattedDate = dateStr || new Date().toLocaleDateString("de-DE");
  return [
    { type: "header", text: { type: "plain_text", text: "🔍 API Testbericht" } },
    { type: "context", elements: [{ type: "mrkdwn", text: `📅 Datum: *${formattedDate}*` }] },
    { type: "divider" }
  ];
}

module.exports = { renderHeaderBlock };