// api-tester/core/slack/slackReporter/renderVersionBlocks.js

/**
 * Rendert Block Kit-Blöcke für automatisch erkannte API-Versionen
 * @param {Array} versionUpdates - Liste von Versionseinträgen { name, url }
 * @returns {Array} Slack Block Kit Blöcke
 */
function renderVersionBlocks(versionUpdates) {
  if (!versionUpdates || versionUpdates.length === 0) return [];

  return [
    { type: "section", text: { type: "mrkdwn", text: "🚀 *Automatisch erkannte neue API-Versionen:*" } },
    ...versionUpdates.flatMap(update => [
      { type: "section", text: { type: "mrkdwn", text: `🔄 *${update.name}*\n🔗 <${update.url}>` } }
    ]),
    { type: "divider" }
  ];
}

module.exports = { renderVersionBlocks };