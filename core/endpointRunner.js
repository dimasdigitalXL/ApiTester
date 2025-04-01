// endpointRunner.js (angepasst auf Zwei-Schritt-Logik)

const path = require("path");
const { promptUserForId } = require("./promptHelper");
const { checkAndUpdateApiVersion } = require("./versionChecker");
const { testEndpoint } = require("./apiCaller");

function stripDataPrefix(str) {
  return str.replace(/^data\[0\]\./, "").replace(/^data\./, "");
}

async function runSingleEndpoint(endpoint, config, versionUpdates, dynamicParamsOverride = {}) {
  if (endpoint.requiresId && !dynamicParamsOverride.id) {
    const defaultIds = require("../default-ids.json");
    const defaultId = defaultIds[endpoint.name];

    if (defaultId) {
      console.log(`🟢 Verwende gespeicherte ID für "${endpoint.name}": ${defaultId}`);
      dynamicParamsOverride.id = defaultId;
      console.log(`🚀 Starte gezielten API-Test für: ${endpoint.name} / ${defaultId}`);
    } else {
      const answer = await promptUserForId(`🟡 Bitte ID für "${endpoint.name}" angeben: `);
      if (!answer) {
        console.warn(`⚠️ Kein Wert eingegeben. Endpunkt "${endpoint.name}" wird übersprungen.`);
        return null;
      }
      dynamicParamsOverride.id = answer;
      console.log(`🚀 Starte gezielten API-Test für: ${endpoint.name} / ${answer}`);
    }
  }

  const updatedEndpoint = await checkAndUpdateApiVersion(endpoint, dynamicParamsOverride);

  if (updatedEndpoint.versionChanged) {
    versionUpdates.push({
      name: endpoint.name,
      url: updatedEndpoint.url,
      expectedStructure: endpoint.expectedStructure
    });

    const index = config.endpoints.findIndex(ep => ep.name === endpoint.name);
    if (index !== -1) config.endpoints[index] = updatedEndpoint;

    // Version wurde erkannt, jetzt abbrechen (2-Schritt-Logik)
    return null;
  }

  // Strukturvergleich & Testauswertung
  const result = await testEndpoint(updatedEndpoint, dynamicParamsOverride, config);

  const { missingFields, extraFields, typeMismatches } = result;

  if (missingFields.length > 0) {
    const cleaned = missingFields.map(stripDataPrefix);
    console.log(`❌ Fehlende Felder: ${cleaned.join(", ")}`);
  }

  if (extraFields.length > 0) {
    const cleaned = extraFields.map(stripDataPrefix);
    console.log(`➕ Zusätzliche Felder: ${cleaned.join(", ")}`);
  }

  if (typeMismatches.length > 0) {
    console.log("⚠️ Typabweichungen:");
    typeMismatches.forEach(tm => {
      const path = stripDataPrefix(tm.path);
      console.log(`• ${path}: erwartet ${tm.expected}, erhalten ${tm.actual}`);
    });
  }

  return result;
}

module.exports = { runSingleEndpoint };