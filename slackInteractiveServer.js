// slackInteractiveServer.js

/**
 * Dieser Server verarbeitet interaktive Slack-Buttons (Einverstanden / Warten)
 * und aktualisiert basierend auf der Auswahl die config.json sowie pending-approvals.json.
 */

const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs-extra");
const path = require("path");
require("dotenv").config();
const { resolveProjectPath } = require("./core/utils"); // zentrale Pfadfunktion zur Pfadsicherheit

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

const approvalsFilePath = resolveProjectPath("pending-approvals.json");
const configPath = resolveProjectPath("config.json");
const expectedDir = resolveProjectPath("expected");

/**
 * Hilfsfunktion:
 * Findet die zuletzt generierte *_updated*.json Datei eines Endpunkts (z. B. Get_View_Customer_updated_v2.json)
 */
function getLatestUpdatedFile(baseName) {
  if (!fs.existsSync(expectedDir)) return null;

  const files = fs.readdirSync(expectedDir);
  const basePattern = new RegExp(`^${baseName}_updated(?:_v(\\d+))?\\.json$`);

  const matching = files
    .map(f => ({ file: f, match: f.match(basePattern) }))
    .filter(f => f.match)
    .sort((a, b) => {
      const aVer = a.match[1] ? parseInt(a.match[1]) : 0;
      const bVer = b.match[1] ? parseInt(b.match[1]) : 0;
      return bVer - aVer;
    });

  return matching.length > 0 ? matching[0].file : null;
}

// Initialisiere approvals-Datei, falls sie noch nicht existiert
if (!fs.existsSync(approvalsFilePath)) {
  fs.writeJsonSync(approvalsFilePath, {});
}

/**
 * POST /slack/actions
 * → Empfängt Slack-Interaktionen (z. B. Button "Einverstanden" oder "Warten")
 * → Aktualisiert die config.json und setzt pending-approvals entsprechend
 */
app.post("/slack/actions", async (req, res) => {
  try {
    const payload = JSON.parse(req.body.payload);
    const action = payload.actions[0];
    const user = payload.user?.username || payload.user?.id || "Unbekannt";
    const endpoint = payload.callback_id; // z. B. Get_View_Customer
    const baseName = endpoint;
    const approvals = await fs.readJson(approvalsFilePath);

    if (action.value === "approve") {
      console.log(`✅ ${user} hat die Struktur für ${endpoint} freigegeben.`);

      const updatedFileName = getLatestUpdatedFile(baseName);
      if (updatedFileName) {
        const updatedFilePath = path.join(expectedDir, updatedFileName);

        if (await fs.exists(configPath)) {
          const config = await fs.readJson(configPath);
          const found = config.endpoints.find(e => e.name.replace(/\s+/g, "_") === baseName);

          console.log(`🔍 Suche config-Eintrag für: ${baseName}`);

          if (found) {
            // Aktualisiere den Pfad zur erwarteten Struktur in config.json
            found.expectedStructure = path
              .relative(resolveProjectPath(), updatedFilePath)
              .replace(/\\/g, "/");

            await fs.writeJson(configPath, config, { spaces: 2 });
            console.log(`🛠️ config.json aktualisiert auf ${found.expectedStructure}`);
          } else {
            console.warn(`⚠️ Kein Eintrag für ${baseName} in config.json gefunden.`);
          }
        } else {
          console.warn("⚠️ config.json nicht gefunden.");
        }
      } else {
        console.warn(`⚠️ Keine *_updated*.json Datei für ${baseName} gefunden.`);
      }

      // 🔄 WICHTIG: Immer auf "waiting" zurücksetzen – so wird bei nächster Änderung wieder Slack gefragt
      approvals[endpoint] = "waiting";
    } else if (action.value === "wait") {
      console.log(`⏸️ ${user} möchte noch warten bei ${endpoint}. Keine Aktion ausgeführt.`);
      approvals[endpoint] = "waiting";
    }

    // Speichere aktualisierten Freigabestatus
    await fs.writeJson(approvalsFilePath, approvals, { spaces: 2 });
    console.log("📝 Schreibe approvals:", approvals);

    // Bestätigung an Slack zurücksenden
    const actionLabel = action.value === "approve" ? "✅ Einverstanden" : "⏸️ Warten";
    res.send({ text: `Aktion empfangen: ${actionLabel} für ${endpoint}` });
  } catch (error) {
    console.error("❌ Fehler in /slack/actions:", error.message);
    res.status(500).send("Interner Fehler beim Verarbeiten der Slack-Aktion.");
  }
});

// Starte den Server
app.listen(3001, () => {
  console.log("⚡️ Slack Interactive Server läuft auf Port 3001");
});