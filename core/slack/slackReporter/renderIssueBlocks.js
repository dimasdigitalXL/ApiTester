// api-tester/core/slack/slackReporter/renderIssueBlocks.js

const stripDataPrefix = str => str.replace(/^data\[0\]\./, "").replace(/^data\./, "");

/**
 * Baut die Slack-Blöcke für Warnungen und kritische Fehler.
 * @param {Array} issues
 * @returns {Array} Slack Block Kit Blöcke
 */
function renderIssueBlocks(issues) {
  return issues.flatMap((issue, index) => {
    const icon = issue.isCritical ? "🔴" : "🟠";
    const missing = issue.missingFields.map(stripDataPrefix);
    const extra = issue.extraFields.map(stripDataPrefix);
    const types = (issue.typeMismatches || []).map(
      m => `${stripDataPrefix(m.path)}: erwartet ${m.expected}, erhalten ${m.actual}`
    );

    const blocks = [
      { type: "section", text: { type: "mrkdwn", text: `*${index + 1}️⃣ ${issue.endpointName}* \`(${issue.method})\` ${icon}` } },
      ...(missing.length > 0 ? [{ type: "context", elements: [{ type: "mrkdwn", text: `⚠️ *Fehlende Felder:* ${missing.join(", ")}` }] }] : []),
      ...(extra.length > 0 ? [
          { type: "context", elements: [{ type: "mrkdwn", text: `⚠️ *Neue Felder:* ${extra.join(", ")}` }] },
          { type: "actions", block_id: "decision_buttons", elements: [
              { type: "button", text: { type: "plain_text", text: "✅ Einverstanden" }, style: "primary", action_id: "open_pin_modal", value: issue.endpointName.replace(/\s+/g, "_") },
              { type: "button", text: { type: "plain_text", text: "⏸️ Warten" }, style: "danger", action_id: "wait_action", value: issue.endpointName.replace(/\s+/g, "_") }
          ] }
        ] : []),
      ...(types.length > 0 ? [{ type: "context", elements: [{ type: "mrkdwn", text: `⚠️ *Typabweichungen:*\n• ${types.join("\n• ")}` }] }] : []),
      { type: "divider" }
    ];
    return blocks;
  });
}

module.exports = { renderIssueBlocks };