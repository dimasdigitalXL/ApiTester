// slackReporter.js

const axios = require("axios");
const path = require("path");

function stripDataPrefix(str) {
  return str.replace(/^data\[0\]\./, "").replace(/^data\./, "");
}

async function sendSlackReport(testResults, versionUpdates = []) {
  try {
    const successCount = testResults.filter(r => r.success).length;
    const warnings = testResults.filter(r =>
      !r.success && !r.isCritical && (r.missingFields.length > 0 || r.extraFields.length > 0 || r.typeMismatches.length > 0)
    );
    const criticals = testResults.filter(r => r.isCritical);
    const totalTests = testResults.length;

    const warningCount = warnings.length;
    const criticalCount = criticals.length;

    let message = `🔍 *API Testbericht - ${new Date().toLocaleDateString("de-DE")}*\n`;
    message += `---------------------------------------------\n`;

    if (versionUpdates.length > 0) {
      message += `🚀 *Automatisch erkannte neue API-Versionen:*\n`;
      versionUpdates.forEach(ep => {
        message += `🔄 *${ep.name}*\n`;
        message += `🔗 Neue API-URL: ${ep.url}\n`;
      });
      message += `---------------------------------------------\n`;
    }

    if (warnings.length > 0 || criticals.length > 0) {
      message += `📌 *Fehlerdetails:*\n`;
    } else {
      message += `✅ *Alle Tests erfolgreich ausgeführt.* Keine Abweichungen gefunden!\n`;
    }

    let issueCounter = 1;
    [...warnings, ...criticals].forEach(issue => {
      const icon = issue.isCritical ? "🔴" : "🟠";
      message += `\n${issueCounter}️⃣ *${issue.endpointName}* (${issue.method}) ${icon}\n`;

      const cleanedMissing = issue.missingFields.map(stripDataPrefix);
      const cleanedExtra = issue.extraFields.map(stripDataPrefix);
      const cleanedTypes = (issue.typeMismatches || []).map(
        m => `${stripDataPrefix(m.path)}: erwartet ${m.expected}, erhalten ${m.actual}`
      );

      if (cleanedMissing.length > 0) {
        message += `⚠️ *Fehlende Attribute:* ${cleanedMissing.join(", ")}\n`;
      }
      if (cleanedExtra.length > 0) {
        message += `⚠️ *Neue Attribute:* ${cleanedExtra.join(", ")}\n`;
      }
      if (cleanedTypes.length > 0) {
        message += `⚠️ *Typabweichungen:*\n• ${cleanedTypes.join("\n• ")}\n`;
      }

      issueCounter++;
    });

    message += `\n---------------------------------------------\n`;
    message += `📊 *Gesamtstatistik:* ${totalTests} API-Calls\n`;
    message += `🔹 🟢 *Erfolgreich:* ${successCount}\n`;
    message += `🔹 🟠 *Achtung:* ${warningCount}\n`;
    message += `🔹 🔴 *Kritisch:* ${criticalCount}\n`;
    message += `📢 *Status:* ${criticalCount > 0 ? "🔴" : warningCount > 0 ? "🟠" : "🟢"}\n`;

    await axios.post(process.env.SLACK_WEBHOOK_URL, { text: message });
    console.log("\n📩 Slack-Testbericht erfolgreich gesendet.");
  } catch (error) {
    console.error("\n❌ Fehler beim Senden des Slack-Berichts:", error.message);
  }
}

module.exports = { sendSlackReport };