// core/slack/handlePinSubmission.js

const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
const { resolveProjectPath } = require("../utils");
const { getSlackWorkspaces } = require("./slackWorkspaces");
const { getLatestUpdatedFile } = require("../structureAnalyzer");
const { getDisplayName } = require("./getDisplayName");

const approvalsFilePath = resolveProjectPath("pending-approvals.json");
const configPath = resolveProjectPath("config.json");
const expectedDir = resolveProjectPath("expected");
const GLOBAL_PIN = process.env.SLACK_APPROVE_PIN || "1234";

/**
 * Behandelt die eingereichte PIN aus dem Slack Modal.
 * @param {object} payload - Slack payload aus view_submission
 * @returns {object|null} response für Slack, falls Fehler
 */
async function handlePinSubmission(payload) {
  const pin = payload.view.state.values.pin_input.pin.value;
  const metadata = JSON.parse(payload.view.private_metadata);
  const { endpoint, original_ts, channel } = metadata;

  const token = getSlackWorkspaces()[0]?.token;
  const userId = payload.user?.id;
  const userName = await getDisplayName(userId, token);
  const approvals = await fs.readJson(approvalsFilePath);

  // Falsche PIN
  if (pin !== GLOBAL_PIN) {
    console.log("❌ Falsche PIN von:", userName);
    return {
      response_action: "errors",
      errors: {
        pin_input: "❌ Falsche PIN. Bitte erneut versuchen."
      }
    };
  }

  console.log(`✅ ${userName} hat ${endpoint} freigegeben (PIN korrekt)`);

  // config.json anpassen
  const updatedFileName = getLatestUpdatedFile(endpoint);
  if (updatedFileName) {
    const updatedFilePath = path.join(expectedDir, updatedFileName);
    if (await fs.exists(configPath)) {
      const config = await fs.readJson(configPath);
      const found = config.endpoints.find(e => e.name.replace(/\s+/g, "_") === endpoint);
      if (found) {
        found.expectedStructure = path
          .relative(resolveProjectPath(), updatedFilePath)
          .replace(/\\/g, "/");
        await fs.writeJson(configPath, config, { spaces: 2 });
        console.log(`🛠️ config.json aktualisiert auf ${found.expectedStructure}`);
      }
    }
  }

  // Zustimmung vermerken
  approvals[endpoint] = "waiting";
  await fs.writeJson(approvalsFilePath, approvals, { spaces: 2 });

  // Originalnachricht aktualisieren
  if (channel && original_ts) {
    await axios.post(
      "https://slack.com/api/chat.update",
      {
        channel,
        ts: original_ts,
        text: `✅ ${userName} hat *${endpoint}* freigegeben.`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `✅ *Freigegeben durch ${userName}*`
            }
          }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        }
      }
    );

    console.log("📤 Originalnachricht aktualisiert (Buttons entfernt)");
  }

  return null; // keine Fehler
}

module.exports = { handlePinSubmission };