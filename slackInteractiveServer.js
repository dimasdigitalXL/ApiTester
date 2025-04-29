// slackInteractiveServer.js

require("dotenv").config();
const express    = require("express");
const bodyParser = require("body-parser");
const fs         = require("fs-extra");
const { spawn }  = require("child_process");

const { validateSignature }   = require("./core/slack/validateSignature");
const { openPinModal }        = require("./core/slack/openPinModal");
const { handlePinSubmission } = require("./core/slack/handlePinSubmission");
const { loadConfig }          = require("./core/configLoader");
const { resolveProjectPath }  = require("./core/utils");

const app = express();

// URL-encoded Parser mit Raw-Body-Capture
app.use(bodyParser.urlencoded({
  extended: true,
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));

// Ping-Endpoint
app.get("/", (req, res) => {
  res.send("✅ Slack Interactive Server läuft!");
});

/**
 * Slash-Commands: /start, /endpoints & /datastruc
 */
app.post("/slack/commands", async (req, res) => {
  console.log("⏺ [slash/commands] headers:", req.headers);
  console.log("⏺ [slash/commands] rawBody:", req.rawBody);

  const rawBody = req.rawBody || "";
  if (!validateSignature(req, rawBody)) {
    return res.status(403).send("Ungültige Signatur.");
  }

  const params     = new URLSearchParams(rawBody);
  const command    = params.get("command");
  const text       = (params.get("text") || "").trim();  // z.B. "Get View Customer"
  const userName   = params.get("user_name");

  // /start [<Endpoint-Name>]
  if (command === "/start") {
    // Bestätigung in Slack
    const confirmation = text
      ? `:rocket: <@${userName}> hat den API-Tester für *${text}* gestartet!`
      : `:rocket: <@${userName}> hat den API-Tester gestartet!`;

    res.json({
      response_type: "in_channel",
      text: confirmation
    });

    // Prozess starten: node index.js [Endpoint-Name]
    const args = text ? ["index.js", text] : ["index.js"];
    console.log(`▶️ [api-tester] gestarted by @${userName} with args:`, args);
    spawn("node", args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit"
    });

    return;
  }

  // /endpoints
  if (command === "/endpoints") {
    try {
      const config = await loadConfig();
      const list   = config.endpoints.map(e => `• ${e.name}`).join("\n");
      return res.json({
        response_type: "in_channel",
        text: `*API-Endpoints in config.json:*\n${list}`
      });
    } catch (err) {
      console.error("🚨 Fehler loadConfig:", err);
      return res.json({
        response_type: "ephemeral",
        text: "❌ Fehler beim Laden der Endpoints."
      });
    }
  }

  // /datastruc <Name>
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
      const data = await fs.readJson(resolveProjectPath(entry.expectedStructure));
      return res.json({
        response_type: "ephemeral",
        text: `*Struktur für ${entry.name}:*\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``
      });
    } catch (err) {
      console.error("🚨 Fehler datastruc:", err);
      return res.json({
        response_type: "ephemeral",
        text: "❌ Fehler beim Laden der Struktur."
      });
    }
  }

  // alles andere: ACK
  return res.sendStatus(200);
});

/**
 * Interactivity-Webhook: Buttons & Modals
 */
app.post("/slack/interactivity", async (req, res) => {
  console.log("⏺ [slash/interactivity] headers:", req.headers);
  console.log("⏺ [slash/interactivity] rawBody:", req.rawBody);

  const rawBody = req.rawBody || "";
  if (!validateSignature(req, rawBody)) {
    return res.status(403).send("Ungültige Signatur.");
  }

  const payload = JSON.parse(new URLSearchParams(rawBody).get("payload"));
  console.log("⏺ [slash/interactivity] payload:", payload);

  // Button „Einverstanden“
  if (payload.type === "block_actions" &&
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

  // PIN-Modal Submission
  if (payload.type === "view_submission" &&
      payload.view.callback_id === "pin_submission"
  ) {
    const result = await handlePinSubmission(payload);
    return res.json(result || {});
  }

  return res.sendStatus(200);
});

module.exports = app;