// api-tester/core/slack/handlePinSubmission.js

const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
const { resolveProjectPath } = require("../utils");
const { getSlackWorkspaces } = require("./slackWorkspaces");
const { getLatestUpdatedFile } = require("../structureAnalyzer");
const { getDisplayName } = require("./getDisplayName");

const approvalsFilePath = resolveProjectPath("pending-approvals.json");
const configPath        = resolveProjectPath("config.json");
const expectedDir       = resolveProjectPath("expected");
const GLOBAL_PIN        = process.env.SLACK_APPROVE_PIN || "1234";

/**
 * Behandelt die PIN aus dem Slack Modal und updated die ursprüngliche Nachricht.
 */
async function handlePinSubmission(payload) {
  const pin = payload.view.state.values.pin_input.pin.value;
  const { endpoint, original_ts, channel } = JSON.parse(payload.view.private_metadata);

  // Wähle das richtige Workspace-Token anhand des Channels
  const workspaces = getSlackWorkspaces();
  const workspace  = workspaces.find(ws => ws.channel === channel);
  if (!workspace) {
    console.error("🚨 Kein Workspace gefunden für Channel:", channel);
    return { response_action: "errors", errors: { pin_input: "Interner Fehler: Workspace nicht gefunden." } };
  }
  const token = workspace.token;
  const userName = await getDisplayName(payload.user.id, token);

  // ❌ Falsche PIN
  if (pin !== GLOBAL_PIN) {
    return {
      response_action: "errors",
      errors: { pin_input: "❌ Falsche PIN. Bitte erneut versuchen." }
    };
  }

  console.log(`✅ ${userName} hat ${endpoint} freigegeben (PIN korrekt)`);

  // 🛠️ Optional: config.json aktualisieren
  const updatedFile = getLatestUpdatedFile(endpoint);
  if (updatedFile && await fs.pathExists(configPath)) {
    const cfg   = await fs.readJson(configPath);
    const entry = cfg.endpoints.find(e => e.name.replace(/\s+/g, "_") === endpoint);
    if (entry) {
      entry.expectedStructure = path
        .relative(resolveProjectPath(), path.join(expectedDir, updatedFile))
        .replace(/\\/g, "/");
      await fs.writeJson(configPath, cfg, { spaces: 2 });
      console.log(`🛠️ config.json aktualisiert: ${entry.expectedStructure}`);
    }
  }

  // ✅ Zustimmung vermerken
  const approvals = await fs.readJson(approvalsFilePath);
  approvals[endpoint] = "waiting";
  await fs.writeJson(approvalsFilePath, approvals, { spaces: 2 });

  // 📤 Slack-Nachricht aktualisieren
  if (channel && original_ts) {
    // Lade gecachte Blöcke aus pending-approvals.json
    const { __rawBlocks = {} } = await fs.readJson(approvalsFilePath);
    const key            = endpoint.replace(/\s+/g, "_");
    const originalBlocks = __rawBlocks[key] || [];

    // Button-Block entfernen
    let cleanedBlocks = originalBlocks.filter(b => b.block_id !== "decision_buttons");

    // Falls der letzte Block ein Divider ist, entferne ihn
    if (
      cleanedBlocks.length > 0 &&
      cleanedBlocks[cleanedBlocks.length - 1].type === "divider"
    ) {
      cleanedBlocks.pop();
    }

    // AKTUALISIERT-Block mit Zeitstempel
    const nowTime = new Date().toLocaleTimeString("de-DE");
    const newSectionBlocks = [
      { type: "divider" },
      { type: "section", text: { type: "mrkdwn", text: "_AKTUALISIERT_" } },
      { type: "context", elements: [{ type: "mrkdwn", text: nowTime }] },
      { type: "section", text: { type: "mrkdwn", text: `✅ *Freigegeben durch ${userName}*` } }
    ];

    // Zusammensetzen aller Blöcke
    const updatedBlocks = [
      ...cleanedBlocks,
      ...newSectionBlocks
    ];

    await axios.post(
      "https://slack.com/api/chat.update",
      {
        channel,
        ts: original_ts,
        text: `✅ ${userName} hat *${endpoint}* freigegeben.`,
        blocks: updatedBlocks
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        }
      }
    );

    console.log("📤 Slack-Nachricht aktualisiert: Report + AKTUALISIERT-Block");
  }

  return null;
}

module.exports = { handlePinSubmission };