// slackReporter.js

const axios = require("axios");
const fs = require("fs-extra");
require("dotenv").config();
const { resolveProjectPath } = require("./utils");

const approvalsFilePath = resolveProjectPath("pending-approvals.json");

/**
 * Entfernt führendes "data." oder "data[0]." aus einem Pfadstring.
 * So wird die Slack-Ausgabe lesbarer.
 */
function stripDataPrefix(str) {
  return str.replace(/^data\[0\]\./, "").replace(/^data\./, "");
}

/**
 * Sendet einen zusammengefassten Testbericht über den Slack-Bot.
 * Zusätzlich werden bei neuen Feldern interaktive Nachrichten mit Buttons gesendet.
 */
async function sendSlackReport(testResults, versionUpdates = []) {
  try {
    const successCount = testResults.filter(r => r.success).length;
    const warnings = testResults.filter(r =>
      !r.success && !r.isCritical &&
      (r.missingFields.length > 0 || r.extraFields.length > 0 || r.typeMismatches.length > 0)
    );
    const criticals = testResults.filter(r => r.isCritical);
    const totalTests = testResults.length;

    const warningCount = warnings.length;
    const criticalCount = criticals.length;

    let message = `🔍 *API Testbericht - ${new Date().toLocaleDateString("de-DE")}*\n`;
    message += `-------------------------------------------------\n`;

    // API-Versionshinweise
    if (versionUpdates.length > 0) {
      message += `🚀 *Automatisch erkannte neue API-Versionen:*\n`;
      versionUpdates.forEach(ep => {
        message += `🔄 *${ep.name}*\n`;
        message += `🔗 Neue API-URL: ${ep.url}\n`;
      });
      message += `-------------------------------------------------\n`;
    }

    // Fehlerausgabe
    if (warnings.length > 0 || criticals.length > 0) {
      message += `📌 *Fehlerdetails:*\n`;
    } else {
      message += `✅ *Alle Tests erfolgreich ausgeführt.* Keine Abweichungen gefunden!\n`;
    }

    // Alle Issues (Warnungen + kritische Fehler)
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

      // Interaktive Freigabe bei neuen Feldern
      if (cleanedExtra.length > 0 && process.env.SLACK_BOT_TOKEN && process.env.SLACK_CHANNEL_ID) {
        // Nachricht mit Buttons
        await axios.post("https://slack.com/api/chat.postMessage", {
          channel: process.env.SLACK_CHANNEL_ID,
          text: `❓ Neue Felder bei *${issue.endpointName}* entdeckt: ${cleanedExtra.join(", ")}\nWie möchtest du fortfahren?`,
          attachments: [
            {
              text: "Bitte Aktion auswählen:",
              callback_id: issue.endpointName.replace(/\s+/g, "_"),
              color: "#f2c744",
              actions: [
                {
                  name: "confirm",
                  text: "✅ Einverstanden",
                  type: "button",
                  value: "approve"
                },
                {
                  name: "wait",
                  text: "⏸️ Warten",
                  type: "button",
                  value: "wait"
                }
              ]
            }
          ]
        }, {
          headers: {
            Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
            "Content-Type": "application/json"
          }
        });

        // ➕ Jetzt separat eine Trennlinie als eigene Slack-Nachricht senden
        await axios.post("https://slack.com/api/chat.postMessage", {
          channel: process.env.SLACK_CHANNEL_ID,
          text: `-------------------------------------------------`
        }, {
          headers: {
            Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
            "Content-Type": "application/json"
          }
        });
      }

      issueCounter++;
    }

    // Statistik & Abschluss
    message += `\n-------------------------------------------------\n`;
    message += `📊 *Gesamtstatistik:* ${totalTests} API-Calls\n`;
    message += `🔹 🟢 *Erfolgreich:* ${successCount}\n`;
    message += `🔹 🟠 *Achtung:* ${warningCount}\n`;
    message += `🔹 🔴 *Kritisch:* ${criticalCount}\n`;
    message += `📢 *Status:* ${criticalCount > 0 ? "🔴" : warningCount > 0 ? "🟠" : "🟢"}\n`;

    // Hauptbericht senden
    if (process.env.SLACK_BOT_TOKEN && process.env.SLACK_CHANNEL_ID) {
      await axios.post("https://slack.com/api/chat.postMessage", {
        channel: process.env.SLACK_CHANNEL_ID,
        text: message
      }, {
        headers: {
          Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
          "Content-Type": "application/json"
        }
      });

      console.log("\n📩 Slack-Testbericht über Bot erfolgreich gesendet.");
    } else {
      console.log("⚠️ Bot-Konfiguration fehlt – Bericht nicht über Bot gesendet.");
    }

  } catch (error) {
    console.error("\n❌ Fehler beim Senden des Slack-Berichts:", error.message);
  }
}

module.exports = { sendSlackReport };