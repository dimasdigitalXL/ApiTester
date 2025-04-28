// index.js

require('dotenv').config();

const fs = require("fs-extra");
const { resolveProjectPath } = require("./core/utils");
const { resetApprovals } = require("./core/resetApprovals");
const { loadConfig } = require("./core/configLoader");
const { runSingleEndpoint } = require("./core/endpointRunner");
const { sendSlackReport, sendToAllWorkspaces } = require("./core/slack/slackReporter/sendSlackReport");
const { validateConfig } = require("./core/validateConfig");

/**
 * Wandle "true"/"false" aus der ENV in echte Booleans um.
 * Jeder nicht-leere String ist sonst truthy, selbst "false".
 */
const disableSlack = (process.env.DISABLE_SLACK || "")
  .toLowerCase() === "true";
const slackDryRun = (process.env.SLACK_DRY_RUN || "")
  .toLowerCase() === "true";

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

async function main() {
  const config = await loadConfig();
  validateConfig(config.endpoints);

  // Reset aller genehmigten Felder auf "waiting", Block-Cache bleibt erhalten
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
      console.error(`❌ Kein API-Call mit dem Namen "${selectedApi}" gefunden.`);
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
    await fs.writeJson(resolveProjectPath("config.json"), config, { spaces: 2 });
    console.log("🔄 API-Versionen in config.json aktualisiert.\n");
  }

  // **Hier wird nun disableSlack verwendet**:
  if (!disableSlack) {
    await sendSlackReport(testResults, versionUpdates, { dryRun: slackDryRun });
  } else {
    console.log(`🔕 Slack-Benachrichtigung ist deaktiviert (DISABLE_SLACK=${process.env.DISABLE_SLACK}).\n`);
  }
}

async function cronRun() {
  // 1) Cron-Start-Notification an alle Workspaces
  await sendToAllWorkspaces({
    text: `⏰ *API-Tester Cronjob* wurde um ${new Date().toLocaleTimeString("de-DE")} automatisch gestartet.`
  });

  // 2) Tests und Report
  await main();

  // 3) Prozess sauber beenden
  process.exit(0);
}

// Entry Point
if (require.main === module) {
  if (process.argv.includes("--cron")) {
    cronRun();
  } else {
    main();
  }
}