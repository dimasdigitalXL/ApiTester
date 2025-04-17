// index.js (mit resetApprovals vor dem Teststart und Cron-Handling)
require("dotenv").config();

// Cron-Start-Nachricht (frühzeitig behandeln und beenden)
if (process.argv.includes("--cron")) {
  const { sendToAllWorkspaces } = require("./core/slack/slackReporter/sendSlackReport");
  (async () => {
    await sendToAllWorkspaces({
      text: `⏰ *API-Tester Cronjob* wurde um ${new Date().toLocaleTimeString("de-DE")} automatisch gestartet.`
    });
    process.exit(0);
  })();
  return;
}

// Normale Testausführung
const fs = require("fs-extra");
const path = require("path");
const { resetApprovals } = require("./core/resetApprovals");
const { loadConfig } = require("./core/configLoader");
const { runSingleEndpoint } = require("./core/endpointRunner");
const { sendSlackReport } = require("./core/slack/slackReporter/sendSlackReport");
const { validateConfig } = require("./core/validateConfig");

/**
 * Führt alle Endpunkte aus der Konfiguration nacheinander aus
 * Gibt die gesammelten Testergebnisse und erkannte Versionsänderungen zurück
 */
async function prepareAndRunAllEndpoints(config) {
  const versionUpdates = [];
  const testResults = [];

  console.log(`🚀 Starte alle API-Tests um ${new Date().toISOString()}`);

  for (const endpoint of config.endpoints) {
    console.log("\n---- Neue API-Test-Abfrage ----");
    const result = await runSingleEndpoint(endpoint, config, versionUpdates);
    if (result) testResults.push(result);
  }

  return { testResults, versionUpdates };
}

/**
 * Hauptfunktion: bereitet alle Tests vor und startet sie
 */
async function main() {
  const config = await loadConfig();
  validateConfig(config.endpoints);

  // 🧹 Setze alle genehmigten Felder wieder auf "waiting"
  await resetApprovals();

  // CLI-Parameter parsen
  const args = process.argv.slice(2);
  const selectedApi = args[0]?.startsWith("--") ? null : args[0];
  const dynamicParams = {};
  args.forEach(arg => {
    const [key, value] = arg.split("=");
    if (key.startsWith("--")) dynamicParams[key.replace("--", "")] = value;
  });

  let testResults = [];
  let versionUpdates = [];

  if (selectedApi) {
    console.log(`🚀 Starte gezielten API-Test für: ${selectedApi}`);
    const endpoint = config.endpoints.find(ep => ep.name === selectedApi);
    if (!endpoint) {
      console.error(`❌ Kein API-Call mit dem Namen "${selectedApi}" gefunden.`);
      process.exit(1);
    }
    const result = await runSingleEndpoint(endpoint, config, versionUpdates, dynamicParams);
    if (result) testResults.push(result);
  } else {
    const resultObj = await prepareAndRunAllEndpoints(config);
    testResults = resultObj.testResults;
    versionUpdates = resultObj.versionUpdates;
  }

  console.log("\n✅ Alle Tests abgeschlossen.\n");

  // Wenn Version-Updates vorliegen, config.json aktualisieren
  if (versionUpdates.length > 0) {
    await fs.writeJson(path.resolve(__dirname, "config.json"), config, { spaces: 2 });
    console.log("🔄 API-Versionen in der Konfigurationsdatei aktualisiert.");
  }

  // Slack-Benachrichtigung
  if (!process.env.DISABLE_SLACK) {
    await sendSlackReport(testResults, versionUpdates);
  } else {
    console.log("🔕 Slack-Benachrichtigung ist deaktiviert (DISABLE_SLACK=true).");
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}