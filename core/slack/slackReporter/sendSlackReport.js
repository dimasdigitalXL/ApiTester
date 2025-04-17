// api-tester/core/slack/slackReporter/sendSlackReport.js

const { getSlackWorkspaces } = require("../slackWorkspaces");
const axios = require("axios");
const fs = require("fs-extra");
const { resolveProjectPath } = require("../../utils");
const { renderHeaderBlock } = require("./renderHeaderBlock");
const { renderIssueBlocks } = require("./renderIssueBlocks");
const { renderStatsBlock } = require("./renderStatsBlock");
const { renderVersionBlocks } = require("./renderVersionBlocks");

const approvalsFilePath = resolveProjectPath("pending-approvals.json");

/**
 * Sendet den API-Testbericht an alle konfigurierten Slack Workspaces.
 * Speichert die gesendeten Blöcke zur späteren Verwendung bei Freigabe.
 * @param {Array} testResults - Ergebnisse der API-Tests
 * @param {Array} versionUpdates - Optionale neue API-Versionen
 */
async function sendSlackReport(testResults, versionUpdates = []) {
  try {
    const workspaces = getSlackWorkspaces();

    const successCount = testResults.filter(r => r.success).length;
    const warnings = testResults.filter(
      r => !r.success && !r.isCritical && (
        r.missingFields.length > 0 ||
        r.extraFields.length > 0 ||
        (r.typeMismatches || []).length > 0
      )
    );
    const criticals = testResults.filter(r => r.isCritical);
    const totalTests = testResults.length;

    const warningCount = warnings.length;
    const criticalCount = criticals.length;
    const today = new Date().toLocaleDateString("de-DE");

    const blocks = [
      ...renderHeaderBlock(today),
      ...(versionUpdates.length > 0 ? renderVersionBlocks(versionUpdates) : []),
      ...(warnings.length > 0 || criticals.length > 0
        ? renderIssueBlocks([...warnings, ...criticals])
        : [{ type: "section", text: { type: "mrkdwn", text: "✅ *Alle Tests erfolgreich ausgeführt. Keine Abweichungen gefunden!*" } }]
      ),
      ...renderStatsBlock(totalTests, successCount, warningCount, criticalCount)
    ];

    for (const { token, channel } of workspaces) {
      if (!token || !channel) continue;
      await axios.post(
        "https://slack.com/api/chat.postMessage",
        { channel, text: "API Testbericht", blocks },
        { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
      );
    }

    // Speichere Blöcke für spätere Freigabe
    const approvals = await fs.readJson(approvalsFilePath);
    approvals.__rawBlocks = approvals.__rawBlocks || {};
    for (const issue of [...warnings, ...criticals]) {
      const key = issue.endpointName.replace(/\s+/g, "_");
      approvals.__rawBlocks[key] = JSON.parse(JSON.stringify(blocks));
    }
    await fs.writeJson(approvalsFilePath, approvals, { spaces: 2 });
    console.log("📩 Slack-Testbericht versendet und Blöcke gespeichert.");
  } catch (err) {
    console.error("❌ Fehler beim Slack-Versand:", err.message);
  }
}

/**
 * Sendet ein beliebiges Payload an alle Workspaces (z. B. Cron-Start)
 * @param {object} payload - { text, blocks? }
 */
async function sendToAllWorkspaces(payload) {
  const workspaces = getSlackWorkspaces();
  for (const { token, channel } of workspaces) {
    if (!token || !channel) continue;
    await axios.post(
      "https://slack.com/api/chat.postMessage",
      { channel, ...payload },
      { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
    );
  }
}

module.exports = { sendSlackReport, sendToAllWorkspaces };