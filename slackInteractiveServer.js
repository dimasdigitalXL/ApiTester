// slackInteractiveServer.js – kombiniert Interactivity und Slash-Commands
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const { validateSignature } = require("./core/slack/validateSignature");
const { openPinModal } = require("./core/slack/openPinModal");
const { handlePinSubmission } = require("./core/slack/handlePinSubmission");
const { loadConfig } = require("./core/configLoader");

const app = express();

// ----- Middleware -----
// Für Interactivity (Block-Actions & Modals)
app.use(
  "/slack/interactivity",
  bodyParser.text({ type: "application/x-www-form-urlencoded" })
);
// Für Slash-Commands (/endpoints)
app.use(
  "/slack/commands",
  bodyParser.text({ type: "application/x-www-form-urlencoded" })
);

// ----- Healthcheck -----
app.get("/", (req, res) => {
  res.send("✅ Slack Interactive Server läuft!");
});

// ----- Slash-Commands Endpoint -----
app.post(
  "/slack/commands",
  async (req, res) => {
    const rawBody = req.body;
    // Signatur validieren
    if (!validateSignature(req, rawBody)) {
      return res.status(403).send("Ungültige Signatur.");
    }

    // Parameter aus rawBody auslesen
    const params = new URLSearchParams(rawBody);
    const command = params.get("command");
    if (command !== "/endpoints") {
      return res.status(200).end();
    }

    // Config laden und Endpoint-Namen sammeln
    const config = await loadConfig();
    const names = config.endpoints.map(e => `• ${e.name}`).join("\n");

    // Antwort an Slack
    return res.json({
      response_type: "in_channel",
      text: `*API‑Endpoints in config.json:*\n${names}`
    });
  }
);

// ----- Interactivity Endpoint -----
app.post(
  "/slack/interactivity",
  async (req, res) => {
    const rawBody = req.body;
    // Signatur validieren
    if (!validateSignature(req, rawBody)) {
      return res.status(403).send("Ungültige Signatur.");
    }

    // Payload extrahieren
    const payload = JSON.parse(new URLSearchParams(rawBody).get("payload"));

    // Button: "Einverstanden" → Modal öffnen
    if (
      payload.type === "block_actions" &&
      payload.actions?.[0]?.action_id === "open_pin_modal"
    ) {
      await openPinModal(
        payload.trigger_id,
        payload.actions[0].value,
        payload.message?.ts,
        payload.channel?.id
      );
      return res.send();
    }

    // Modal eingereicht → PIN prüfen & Slack-Message aktualisieren
    if (
      payload.type === "view_submission" &&
      payload.view.callback_id === "pin_submission"
    ) {
      const result = await handlePinSubmission(payload);
      return res.json(result || {});
    }

    // Default fallback
    res.sendStatus(200);
  }
);

module.exports = app;