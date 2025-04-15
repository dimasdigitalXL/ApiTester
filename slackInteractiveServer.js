// slackInteractiveServer.js – mit Block-Kit Unterstützung + Modal PIN Verifizierung + Button-Update

const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
const crypto = require("crypto");
require("dotenv").config();
const { resolveProjectPath } = require("./core/utils");
const { getSlackWorkspaces } = require("./core/slackWorkspaces");

const app = express();
const approvalsFilePath = resolveProjectPath("pending-approvals.json");
const configPath = resolveProjectPath("config.json");
const expectedDir = resolveProjectPath("expected");
const GLOBAL_PIN = process.env.SLACK_APPROVE_PIN || "1234";

// Slack erwartet URL-encoded Format bei interaktiven POSTs
app.use("/slack/interactivity", bodyParser.text({ type: "application/x-www-form-urlencoded" }));

// Slack-Signatur validieren zur Sicherheit
function isValidSlackSignature(req, rawBody) {
  const timestamp = req.headers["x-slack-request-timestamp"];
  const signature = req.headers["x-slack-signature"];
  if (!timestamp || !signature) return false;

  const baseString = `v0:${timestamp}:${rawBody}`;
  const secrets = getSlackWorkspaces().map(ws => ws.signingSecret).filter(Boolean);

  return secrets.some(secret => {
    const hash = "v0=" + crypto.createHmac("sha256", secret).update(baseString).digest("hex");
    try {
      return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(hash));
    } catch {
      return false;
    }
  });
}

// Nutzeranzeige-Name aus Slack laden
async function getDisplayName(userId, token) {
  try {
    const result = await axios.get("https://slack.com/api/users.info", {
      params: { user: userId },
      headers: { Authorization: `Bearer ${token}` }
    });
    if (result.data.ok) {
      const profile = result.data.user.profile;
      return profile.display_name || profile.real_name || userId;
    }
  } catch (err) {
    console.warn("⚠️ Nutzername nicht abrufbar:", err.message);
  }
  return userId;
}

// Neueste *_updated*.json Datei zum Endpunkt holen
function getLatestUpdatedFile(baseName) {
  if (!fs.existsSync(expectedDir)) return null;
  const files = fs.readdirSync(expectedDir);
  const regex = new RegExp(`^${baseName}_updated(?:_v(\\d+))?\\.json$`);
  const matching = files
    .map(f => ({ file: f, match: f.match(regex) }))
    .filter(f => f.match)
    .sort((a, b) => parseInt(b.match[1] || 0) - parseInt(a.match[1] || 0));
  return matching.length > 0 ? matching[0].file : null;
}

// Initialisiere Approvals-Datei, falls nicht vorhanden
if (!fs.existsSync(approvalsFilePath)) {
  fs.writeJsonSync(approvalsFilePath, {});
}

// Online-Testroute
app.get("/", (req, res) => {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unbekannt";
  const time = new Date().toLocaleTimeString("de-DE");
  const isNgrok = req.headers.host?.includes("ngrok");
  const label = isNgrok ? "🌍 EXTERN (ngrok)" : "💻 LOKAL";
  console.log(`🛰️  [${time}] Zugriff erkannt – ${label} – IP: ${ip}`);
  res.status(200).send("✅ Slack Interactive Server läuft aktuell!");
});

// Interaktivität verarbeiten (Modal oder PIN-Verifizierung)
app.post("/slack/interactivity", async (req, res) => {
  console.log("\n📥 POST /slack/interactivity empfangen");
  console.log("🧩 Header:", req.headers);
  console.log("📦 Body:", req.body);

  if (!isValidSlackSignature(req, req.body)) {
    console.log("❌ Ungültige Slack-Signatur für /interactivity");
    return res.status(403).send("❌ Ungültige Slack-Signatur.");
  }

  const parsed = new URLSearchParams(req.body);
  const payload = JSON.parse(parsed.get("payload"));
  const token = getSlackWorkspaces()[0]?.token;

  // === Button wurde geklickt → Modal öffnen
  if (payload.type === "block_actions" && payload.actions?.[0]?.action_id === "open_pin_modal") {
    const endpoint = payload.actions[0].value;
    const triggerId = payload.trigger_id;
    const message_ts = payload.message?.ts;
    const channel_id = payload.channel?.id;

    // Temporär mitgeben
    const metadata = JSON.stringify({
      endpoint,
      original_ts: message_ts,
      channel: channel_id
    });

    await axios.post("https://slack.com/api/views.open", {
      trigger_id: triggerId,
      view: {
        type: "modal",
        callback_id: "pin_submission",
        private_metadata: metadata,
        title: { type: "plain_text", text: "Verifizierung" },
        submit: { type: "plain_text", text: "Bestätigen" },
        close: { type: "plain_text", text: "Abbrechen" },
        blocks: [
          {
            type: "input",
            block_id: "pin_input",
            label: { type: "plain_text", text: "Bitte PIN eingeben:" },
            element: {
              type: "plain_text_input",
              action_id: "pin",
              placeholder: { type: "plain_text", text: "nur wenn du richtige PIN hast, kommst du rein ;)" }
            }
          }
        ]
      }
    }, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    });

    return res.send(); // Modal wurde gesendet
  }

  // === Modal wurde eingereicht → PIN prüfen
  if (payload.type === "view_submission" && payload.view.callback_id === "pin_submission") {
    const pin = payload.view.state.values.pin_input.pin.value;
    const metadata = JSON.parse(payload.view.private_metadata);
    const { endpoint, original_ts, channel } = metadata;

    const userId = payload.user?.id;
    const userName = await getDisplayName(userId, token);
    const approvals = await fs.readJson(approvalsFilePath);

    if (pin !== GLOBAL_PIN) {
      console.log("❌ Falsche PIN von:", userName);
      return res.json({
        response_action: "errors",
        errors: {
          pin_input: "❌ Falsche PIN. Bitte erneut versuchen."
        }
      });
    }

    console.log(`✅ ${userName} hat ${endpoint} freigegeben (PIN korrekt)`);

    // Config anpassen
    const updatedFileName = getLatestUpdatedFile(endpoint);
    if (updatedFileName) {
      const updatedFilePath = path.join(expectedDir, updatedFileName);
      if (await fs.exists(configPath)) {
        const config = await fs.readJson(configPath);
        const found = config.endpoints.find(e => e.name.replace(/\s+/g, "_") === endpoint);
        if (found) {
          found.expectedStructure = path.relative(resolveProjectPath(), updatedFilePath).replace(/\\/g, "/");
          await fs.writeJson(configPath, config, { spaces: 2 });
          console.log(`🛠️ config.json aktualisiert auf ${found.expectedStructure}`);
        }
      }
    }

    approvals[endpoint] = "waiting";
    await fs.writeJson(approvalsFilePath, approvals, { spaces: 2 });

    // Ursprüngliche Nachricht aktualisieren → Buttons entfernen
    if (channel && original_ts) {
      await axios.post("https://slack.com/api/chat.update", {
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
      }, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        }
      });

      console.log("📤 Originalnachricht aktualisiert (Buttons entfernt)");
    }

    return res.send(); // Modal schließen
  }

  console.log("ℹ️ Keine relevante Interaktion erkannt.");
  res.sendStatus(200);
});

// Starte den Server
app.listen(3001, () => {
  console.log("⚡️ Slack Interactive Server läuft auf Port 3001");
});