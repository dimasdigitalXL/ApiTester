// index.js (mit resetApprovals vor dem Teststart)

require("dotenv").config();

const path = require("path");
const fs = require("fs-extra");

// Reset-Modul importieren
const { resetApprovals } = require("./core/resetApprovals");

const { loadConfig } = require("./core/configLoader");
const { runSingleEndpoint } = require("./core/endpointRunner");
const { sendSlackReport } = require("./core/slackReporter");
const { validateConfig } = require("./core/validateConfig");

/**
 * Führt alle Endpunkte aus der Konfiguration nacheinander aus
 * Gibt die gesammelten Testergebnisse und erkannte Versionsänderungen zurück
 */
async function prepareAndRunAllEndpoints(config) {
  const versionUpdates = [];
  const testResults = [];

  console.log(`🚀 Starte alle API-Tests um ${new Date().toISOString()}\n`);

  for (const endpoint of config.endpoints) {
    console.log("\n---- Neue API-Test-Abfrage ----");
    const result = await runSingleEndpoint(endpoint, config, versionUpdates);
    if (result) testResults.push(result);
  }

  return { testResults, versionUpdates };
}

/**
 * Hauptfunktion: bereitet alle Tests vor und startet sie
 * Erkennt CLI-Parameter und behandelt gezielte oder vollständige API-Tests
 */
async function main() {
  const config = await loadConfig();
  validateConfig(config.endpoints);

  // 🧹 Setze alle genehmigten Felder wieder auf "waiting"
  await resetApprovals();

  const args = process.argv.slice(2);
  const selectedApi = args[0]?.startsWith("--") ? null : args[0];
  const dynamicParams = {};

  args.forEach(arg => {
    const [key, value] = arg.split("=");
    if (key.startsWith("--")) {
      dynamicParams[key.replace("--", "")] = value;
    }
  });

  let testResults = [];
  let versionUpdates = [];

  if (selectedApi) {
    console.log(`🚀 Starte gezielten API-Test für: ${selectedApi}\n`);
    const endpoint = config.endpoints.find(ep => ep.name === selectedApi);

    if (!endpoint) {
      console.error(`❌ Fehler: Kein API-Call mit dem Namen "${selectedApi}" gefunden.\n`);
      return;
    }

    const result = await runSingleEndpoint(endpoint, config, versionUpdates, dynamicParams);
    if (result) testResults.push(result);
  } else {
    const resultObj = await prepareAndRunAllEndpoints(config);
    testResults = resultObj.testResults;
    versionUpdates = resultObj.versionUpdates;
  }

  console.log("\n✅ Alle Tests abgeschlossen.\n");

  if (versionUpdates.length > 0) {
    await fs.writeJson("config.json", config, { spaces: 2 });
    console.log("\n🔄 API-Versionen wurden in der Konfigurationsdatei aktualisiert.\n");
  }

  if (!process.env.DISABLE_SLACK) {
    await sendSlackReport(testResults, versionUpdates);
  } else {
    console.log("\n🔕 Slack-Benachrichtigung ist deaktiviert (DISABLE_SLACK=true).\n");
  }
}

if (require.main === module) {
  main();
}