// index.js (neue orchestrierte Hauptdatei)

// Lädt Umgebungsvariablen aus einer .env-Datei
require("dotenv").config();

const path = require("path");
const fs = require("fs-extra");

// Import der zentralen Module
const { loadConfig } = require("./core/configLoader"); // Lädt die config.json (API-Testdefinitionen)
const { runSingleEndpoint } = require("./core/endpointRunner"); // Führt einen API-Test durch
const { sendSlackReport } = require("./core/slackReporter"); // Sendet Slack-Report (falls aktiviert)
const { validateConfig } = require("./core/validateConfig"); // Überprüft Gültigkeit der Konfiguration

/**
 * Führt alle Endpunkte aus der Konfiguration nacheinander aus
 * Gibt die gesammelten Testergebnisse und erkannte Versionsänderungen zurück
 */
async function prepareAndRunAllEndpoints(config) {
  const versionUpdates = []; // Speichert erkannte API-Versionsupdates
  const testResults = []; // Speichert die Ergebnisse der einzelnen Tests

  console.log(`🚀 Starte alle API-Tests um ${new Date().toISOString()}\n`);

  for (const endpoint of config.endpoints) {
    console.log("\n---- Neue API-Test-Abfrage ----");
    const result = await runSingleEndpoint(endpoint, config, versionUpdates);
    if (result) testResults.push(result);
  }

  return { testResults, versionUpdates };
}

/**
 * Haupteinstiegspunkt für das CLI-Tool
 * Erkennt, ob alle Endpunkte oder nur ein bestimmter getestet werden sollen
 * Verarbeitet dynamische Parameter und Slack-Konfiguration
 */
async function main() {
  const endpoints = await loadConfig(); // Lädt alle definierten API-Endpunkte
  validateConfig(endpoints); // Prüft grundlegende Gültigkeit der Struktur

  const args = process.argv.slice(2); // CLI-Argumente
  const selectedApi = args[0]?.startsWith("--") ? null : args[0]; // Name des spezifischen Endpunkts (falls angegeben)
  const dynamicParams = {}; // Weitere dynamische Parameter

  // Parsen von Argumenten wie --id=123
  args.forEach(arg => {
    const [key, value] = arg.split("=");
    if (key.startsWith("--")) {
      dynamicParams[key.replace("--", "")] = value;
    }
  });

  const config = { endpoints };
  let testResults = [];
  let versionUpdates = [];

  if (selectedApi) {
    // Führe gezielten Test für einen bestimmten API-Endpunkt durch
    console.log(`🚀 Starte gezielten API-Test für: ${selectedApi}\n`);
    const endpoint = endpoints.find(ep => ep.name === selectedApi);

    if (!endpoint) {
      console.error(`❌ Fehler: Kein API-Call mit dem Namen "${selectedApi}" gefunden.\n`);
      return;
    }

    const result = await runSingleEndpoint(endpoint, config, versionUpdates, dynamicParams);
    if (result) testResults.push(result);
  } else {
    // Führe vollständige Test-Suite aus
    const resultObj = await prepareAndRunAllEndpoints(config);
    testResults = resultObj.testResults;
    versionUpdates = resultObj.versionUpdates;
  }

  console.log("\n✅ Alle Tests abgeschlossen.\n");

  // Speichere neue API-Versionen (wenn erkannt)
  if (versionUpdates.length > 0) {
    await fs.writeJson("config.json", config, { spaces: 2 });
    console.log("\n🔄 API-Versionen wurden in der Konfigurationsdatei aktualisiert.\n");
  }

  // Schicke Slack-Benachrichtigung, falls aktiviert
  if (!process.env.DISABLE_SLACK) {
    await sendSlackReport(testResults, versionUpdates);
  } else {
    console.log("\n🔕 Slack-Benachrichtigung ist deaktiviert (DISABLE_SLACK=true).\n");
  }
}

// Starte nur, wenn Datei direkt aufgerufen wurde (nicht als Modul)
if (require.main === module) {
  main();
}