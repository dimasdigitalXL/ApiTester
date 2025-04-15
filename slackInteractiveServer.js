// slackInteractiveServer.js – sauber modularisiert
const express = require("express");
const bodyParser = require("body-parser");
const { validateSignature } = require("./core/slack/validateSignature");
const { openPinModal } = require("./core/slack/openPinModal");
const { handlePinSubmission } = require("./core/slack/handlePinSubmission");

const app = express();
app.use("/slack/interactivity", bodyParser.text({ type: "application/x-www-form-urlencoded" }));

// Ping-Test (optional)
app.get("/", (req, res) => {
  res.send("✅ Slack Interactive Server läuft!");
});

// Interaktion: Modal öffnen oder PIN auswerten
app.post("/slack/interactivity", async (req, res) => {
  const rawBody = req.body;
  if (!validateSignature(req, rawBody)) {
    return res.status(403).send("Ungültige Signatur.");
  }

  const payload = JSON.parse(new URLSearchParams(rawBody).get("payload"));

  // Button: "Einverstanden" → Modal öffnen
  if (payload.type === "block_actions" && payload.actions?.[0]?.action_id === "open_pin_modal") {
    await openPinModal(
      payload.trigger_id,
      payload.actions[0].value,
      payload.message?.ts,
      payload.channel?.id
    );
    return res.send();
  }

  // Modal eingereicht → PIN prüfen & Slack-Message aktualisieren
  if (payload.type === "view_submission" && payload.view.callback_id === "pin_submission") {
    const result = await handlePinSubmission(payload);
    return res.json(result || {});
  }

  res.sendStatus(200); // Default fallback
});

module.exports = app;