// slackInteractiveServer.js

require("dotenv").config();
const express    = require("express");
const bodyParser = require("body-parser");
const fs         = require("fs-extra");
const { validateSignature }  = require("./core/slack/validateSignature");
const { openPinModal }       = require("./core/slack/openPinModal");
const { handlePinSubmission }= require("./core/slack/handlePinSubmission");
const { loadConfig }         = require("./core/configLoader");
const { resolveProjectPath } = require("./core/utils");

const app = express();

// 1) URL-encoded Parser mit Raw-Body-Capture
app.use(bodyParser.urlencoded({
  extended: true,
  verify: (req, res, buf) => {
    // Hier speichern wir den echten Slack-Payload für die Signatur-Prüfung:
    req.rawBody = buf.toString();
  }
}));

// 2) Ping-Endpoint, um zu prüfen, ob der Server erreichbar ist
app.get("/", (req, res) => {
  res.send("✅ Slack Interactive Server läuft!");
});

/**
 * 3) Slash-Commands: /endpoints & /datastruc
 */
app.post("/slack/commands", async (req, res) => {
  // ==== LOGGING BEGINN ====
  console.log("⏺ [slash/commands] eingehende Anfrage:");
  console.log("⏺ headers:", JSON.stringify(req.headers, null, 2));
  console.log("⏺ rawBody:", req.rawBody);
  // ==== LOGGING ENDE ====

  const rawBody = req.rawBody || "";
  if (!validateSignature(req, rawBody)) {
    console.error("🚨 [slash/commands] Ungültige Signatur");
    return res.status(403).send("Ungültige Signatur.");
  }

  const params  = new URLSearchParams(rawBody);
  const command = params.get("command");
  const text    = (params.get("text") || "").trim();

  // /endpoints → Liste aller Endpoint-Namen
  if (command === "/endpoints") {
    try {
      const config = await loadConfig();
      const names  = config.endpoints.map(e => `• ${e.name}`).join("\n");
      return res.json({
        response_type: "in_channel",
        text: `*API-Endpoints in config.json:*\n${names}`
      });
    } catch (err) {
      console.error("🚨 [slash/commands] Fehler loadConfig:", err);
      return res.json({
        response_type: "ephemeral",
        text: "❌ Fehler beim Laden der Endpoints."
      });
    }
  }

  // /datastruc <Name> → JSON-Struktur der expectedStructure
  if (command === "/datastruc") {
    try {
      const config = await loadConfig();
      const entry  = config.endpoints.find(e => e.name === text);
      if (!entry) {
        return res.json({
          response_type: "ephemeral",
          text: `❌ Endpoint «${text}» nicht gefunden.`
        });
      }

      const filePath = resolveProjectPath(entry.expectedStructure);
      const data     = await fs.readJson(filePath);
      return res.json({
        response_type: "ephemeral",
        text: `*Aktuelle Struktur für ${entry.name}:*\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``
      });
    } catch (err) {
      console.error("🚨 [slash/commands] Fehler datastruc:", err);
      return res.json({
        response_type: "ephemeral",
        text: "❌ Fehler beim Laden der Struktur."
      });
    }
  }

  // Unbekannter Command → ruhig mit 200 acken
  return res.sendStatus(200);
});

/**
 * 4) Interactivity-Webhook: Buttons & Modals
 */
app.post("/slack/interactivity", async (req, res) => {
  // ==== LOGGING BEGINN ====
  console.log("⏺ [slash/interactivity] eingehende Anfrage:");
  console.log("⏺ headers:", JSON.stringify(req.headers, null, 2));
  console.log("⏺ rawBody:", req.rawBody);
  // ==== LOGGING ENDE ====

  const rawBody = req.rawBody || "";
  if (!validateSignature(req, rawBody)) {
    console.error("🚨 [slash/interactivity] Ungültige Signatur");
    return res.status(403).send("Ungültige Signatur.");
  }

  const payload = JSON.parse(new URLSearchParams(rawBody).get("payload"));
  console.log("⏺ [slash/interactivity] payload:", JSON.stringify(payload, null, 2));

  // Button "Einverstanden" → PIN-Modal öffnen
  if (
    payload.type === "block_actions" &&
    payload.actions?.[0]?.action_id === "open_pin_modal"
  ) {
    try {
      await openPinModal(
        payload.trigger_id,
        payload.actions[0].value,
        payload.message?.ts,
        payload.channel?.id
      );
    } catch (err) {
      console.error("🚨 [slash/interactivity] openPinModal-Error:", err);
    }
    return res.send(); // schnell acken
  }

  // PIN-Modal eingereicht → Prüfung & Nachricht aktualisieren
  if (
    payload.type === "view_submission" &&
    payload.view.callback_id === "pin_submission"
  ) {
    try {
      const result = await handlePinSubmission(payload);
      return res.json(result || {});
    } catch (err) {
      console.error("🚨 [slash/interactivity] handlePinSubmission-Error:", err);
      return res.json({});
    }
  }

  // Sonst einfach 200 zurückgeben
  return res.sendStatus(200);
});

module.exports = app;