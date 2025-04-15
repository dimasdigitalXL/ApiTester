// core/slackReporter.js – mit Block Kit + Modal-PIN-Verifizierung (Funktion B)

const axios = require("axios");
const fs = require("fs-extra");
require("dotenv").config();
const { resolveProjectPath } = require("./utils");
const { getSlackWorkspaces } = require("./slackWorkspaces");

const approvalsFilePath = resolveProjectPath("pending-approvals.json");

function stripDataPrefix(str) {
  return str.replace(/^data\[0\]\./, "").replace(/^data\./, "");
}

async function sendToAllWorkspaces(payload) {
  const workspaces = getSlackWorkspaces();

  for (const { token, channel } of workspaces) {
    if (!token || !channel) continue;
    try {
      await axios.post(
        "https://slack.com/api/chat.postMessage",
        { ...payload, channel },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          }
        }
      );
    } catch (err) {
      console.error("❌ Fehler beim Senden an Slack Workspace:", err.message);
    }
  }
}

async function sendSlackReport(testResults, versionUpdates = []) {
  try {
    const successCount = testResults.filter(r => r.success).length;
    const warnings = testResults.filter(
      r =>
        !r.success &&
        !r.isCritical &&
        (r.missingFields.length > 0 ||
         r.extraFields.length > 0 ||
         r.typeMismatches.length > 0)
    );
    const criticals = testResults.filter(r => r.isCritical);
    const totalTests = testResults.length;

    const warningCount = warnings.length;
    const criticalCount = criticals.length;

    let message = `🔍 *API Testbericht - ${new Date().toLocaleDateString("de-DE")}*\n`;
    message += `-------------------------------------------------\n`;

    if (versionUpdates.length > 0) {
      message += `🚀 *Automatisch erkannte neue API-Versionen:*\n`;
      versionUpdates.forEach(ep => {
        message += `🔄 *${ep.name}*\n`;
        message += `🔗 Neue API-URL: ${ep.url}\n`;
      });
      message += `-------------------------------------------------\n`;
    }

    if (warnings.length > 0 || criticals.length > 0) {
      message += `📌 *Fehlerdetails:*\n`;
    } else {
      message += `✅ *Alle Tests erfolgreich ausgeführt.* Keine Abweichungen gefunden!\n`;
    }

    let issueCounter = 1;
    for (const issue of [...warnings, ...criticals]) {
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

      // Block Kit Buttons (Funktion B: open_pin_modal und wait_action)
      if (cleanedExtra.length > 0) {
        await sendToAllWorkspaces({
          text: `❓ Neue Felder bei *${issue.endpointName}* entdeckt.`,
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `*Neue Attribute:* ${cleanedExtra.join(", ")}\nWie möchtest du fortfahren?`
              }
            },
            {
              type: "actions",
              block_id: "decision_buttons",
              elements: [
                {
                  type: "button",
                  text: { type: "plain_text", text: "✅ Einverstanden" },
                  style: "primary",
                  action_id: "open_pin_modal",
                  value: issue.endpointName.replace(/\s+/g, "_")
                },
                {
                  type: "button",
                  text: { type: "plain_text", text: "⏸️ Warten" },
                  style: "danger",
                  action_id: "wait_action",
                  value: issue.endpointName.replace(/\s+/g, "_")
                }
              ]
            },
            { type: "divider" }
          ]
        });
      }

      issueCounter++;
    }

    message += `\n-------------------------------------------------\n`;
    message += `📊 *Gesamtstatistik:* ${totalTests} API-Calls\n`;
    message += `🔹 🟢 *Erfolgreich:* ${successCount}\n`;
    message += `🔹 🟠 *Achtung:* ${warningCount}\n`;
    message += `🔹 🔴 *Kritisch:* ${criticalCount}\n`;
    message += `📢 *Status:* ${criticalCount > 0 ? "🔴" : warningCount > 0 ? "🟠" : "🟢"}\n`;

    await sendToAllWorkspaces({ text: message });

    console.log("\n📩 Slack-Testbericht an alle Workspaces gesendet.");
  } catch (error) {
    console.error("\n❌ Fehler beim Slack-Versand:", error.message);
  }
}

module.exports = { sendSlackReport };