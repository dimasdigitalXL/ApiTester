// api-tester/core/slack/slackReporter/renderStatsBlock.js

/**
 * Generiert die Block-Kit-Sektion für die Gesamtstatistik.
 * @param {number} total
 * @param {number} success
 * @param {number} warnings
 * @param {number} critical
 * @returns {Array} Slack Block-Kit-Blöcke
 */
function renderStatsBlock(total, success, warnings, critical) {
  const statusEmoji = critical > 0 ? "🔴" : warnings > 0 ? "🟠" : "🟢";
  return [
    { type: "section", text: { type: "mrkdwn", text: `📊 *Gesamtstatistik:* ${total} API-Calls` } },
    { type: "section", text: { type: "mrkdwn", text: `🔹 🟢 *Erfolgreich:* ${success}\n🔹 🟠 *Achtung:* ${warnings}\n🔹 🔴 *Kritisch:* ${critical}` } },
    { type: "section", text: { type: "mrkdwn", text: `📢 *Status:* ${statusEmoji}` } },
    { type: "divider" }
  ];
}

module.exports = { renderStatsBlock };