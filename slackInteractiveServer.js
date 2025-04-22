// slackInteractiveServer.js

const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const fs = require("fs-extra");
const { validateSignature } = require("./core/slack/validateSignature");
const { openPinModal }      = require("./core/slack/openPinModal");
const { handlePinSubmission } = require("./core/slack/handlePinSubmission");
const { loadConfig }        = require("./core/configLoader");
const { resolveProjectPath } = require("./core/utils");

const app = express();

// Wir brauchen den Roh‑Body für beide Webhooks
app.use(bodyParser.text({ type: "application/x-www-form-urlencoded" }));

// Ping‑Endpunkt (optional)
app.get("/", (req, res) => {
  res.send("✅ Slack Interactive Server läuft!");
});

/**
 * Slash-Commands: /endpoints und /datastruc
 */
app.post("/slack/commands", async (req, res) => {
  const rawBody = req.body;
  // Signatur prüfen
  if (!validateSignature(req, rawBody)) {
    return res.status(403).send("Ungültige Signatur.");
  }

  const params  = new URLSearchParams(rawBody);
  const command = params.get("command");
  const text    = (params.get("text") || "").trim();

  // /endpoints → Liste aller Endpoint-Namen
  if (command === "/endpoints") {
    const config = await loadConfig();
    const names  = config.endpoints.map(e => `• ${e.name}`).join("\n");
    return res.json({
      response_type: "in_channel",
      text: `*API‑Endpoints in config.json:*\n${names}`
    });
  }

  // /datastruc <Name> → JSON‑Struktur der expectedStructure
  if (command === "/datastruc") {
    const config = await loadConfig();
    const entry  = config.endpoints.find(e => e.name === text);
    if (!entry) {
      return res.json({
        response_type: "ephemeral",
        text: `❌ Endpoint «${text}» nicht gefunden.`
      });
    }

    const filePath = resolveProjectPath(entry.expectedStructure);
    let data;
    try {
      data = await fs.readJson(filePath);
    } catch (err) {
      return res.json({
        response_type: "ephemeral",
        text: `❌ Konnte Datei nicht lesen: \`${entry.expectedStructure}\``
      });
    }

    return res.json({
      response_type: "ephemeral",
      text: `*Aktuelle Struktur für ${entry.name}:*\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``
    });
  }

  // Andere Commands ignorieren
  return res.status(200).end();
});

/**
 * Interactivity‑Webhook: Buttons & Modals
 */
app.post("/slack/interactivity", async (req, res) => {
  const rawBody = req.body;
  if (!validateSignature(req, rawBody)) {
    return res.status(403).send("Ungültige Signatur.");
  }

  const payload = JSON.parse(new URLSearchParams(rawBody).get("payload"));

  // Button "Einverstanden" → PIN‑Modal öffnen
  if (payload.type === "block_actions" && payload.actions?.[0]?.action_id === "open_pin_modal") {
    await openPinModal(
      payload.trigger_id,
      payload.actions[0].value,
      payload.message?.ts,
      payload.channel?.id
    );
    return res.send();
  }

  // PIN‑Modal eingereicht → Prüfung & Nachricht aktualisieren
  if (payload.type === "view_submission" && payload.view.callback_id === "pin_submission") {
    const result = await handlePinSubmission(payload);
    return res.json(result || {});
  }

  // Fallback
  res.sendStatus(200);
});

module.exports = app;