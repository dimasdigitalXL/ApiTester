// api-tester/core/endpointRunner.js

const { promptUserForId } = require("./promptHelper");
const { checkAndUpdateApiVersion } = require("./versionChecker");
const { testEndpoint } = require("./apiCaller");

// Lade alle Default‐IDs (Zahl/String oder Objekt)
const defaultIds = require("../default-ids.json");

/** Entfernt das data.-Präfix für saubere Logs */
function stripDataPrefix(str) {
  return str.replace(/^data\[0\]\./, "").replace(/^data\./, "");
}

async function runSingleEndpoint(
  endpoint,
  config,
  versionUpdates,
  dynamicParamsOverride = {}
) {
  // Multi-/Single-ID-Handling 
  if (endpoint.requiresId) {
    // 1.1) Default-Eintrag nach Name oder Unterstrich-Key
    let defEntry = defaultIds[endpoint.name];
    if (defEntry === undefined) {
      defEntry = defaultIds[endpoint.name.replace(/\s+/g, "_")];
    }
    console.log("🔍 default-ids.json für", endpoint.name, "→", defEntry);

    // 1.2) Params ermitteln: Objekt → alle Keys, sonst nur "id"
    const isObject = defEntry !== null && typeof defEntry === "object";
    const params = isObject ? Object.keys(defEntry) : ["id"];

    // 1.3) Für jeden Param:
    for (const key of params) {
      if (!dynamicParamsOverride[key]) {
        // → Primitive Default (Zahl/String) befüllen
        if (!isObject && key === "id" && defEntry != null) {
          dynamicParamsOverride.id = String(defEntry);
          console.log(
            `🟢 Verwende gespeicherte id für "${endpoint.name}": ${defEntry}`
          );
        }
        // → Objekt-Default für mehrfache Params
        else if (
          isObject &&
          defEntry[key] != null
        ) {
          dynamicParamsOverride[key] = String(defEntry[key]);
          console.log(
            `🟢 Verwende gespeicherte ${key} für "${endpoint.name}": ${defEntry[key]}`
          );
        }
        // → sonst CLI-Abfrage
        else {
          const answer = await promptUserForId(
            `🟡 Bitte Wert für "${key}" bei "${endpoint.name}" angeben: `
          );
          if (!answer) {
            console.warn(
              `⚠️ Kein Wert für ${key} eingegeben. Überspringe "${endpoint.name}".`
            );
            return null;
          }
          dynamicParamsOverride[key] = answer;
          console.log(
            `🟢 Nutzer-Eingabe ${key} für "${endpoint.name}": ${answer}`
          );
        }
      }
    }

    console.log(
      `🚀 Starte Test für "${endpoint.name}" mit Parametern: ` +
        params.map((k) => `${k}=${dynamicParamsOverride[k]}`).join(", ")
    );
  }

  // Versionserkennung 
  const updatedEndpoint = await checkAndUpdateApiVersion(
    endpoint,
    dynamicParamsOverride
  );
  if (updatedEndpoint.versionChanged) {
    versionUpdates.push({
      name: endpoint.name,
      url: updatedEndpoint.url,
      expectedStructure: endpoint.expectedStructure,
    });
    // Config updaten
    const idx = config.endpoints.findIndex((e) => e.name === endpoint.name);
    if (idx !== -1) config.endpoints[idx] = updatedEndpoint;
    console.log(
      `🔄 Neue API-Version für "${endpoint.name}": ${updatedEndpoint.url}`
    );
    return null; // 2-Schritt-Logik: hier abbrechen
  }

  // Struktur- & Typvergleich 
  const result = await testEndpoint(
    updatedEndpoint,
    dynamicParamsOverride,
    config
  );
  const { missingFields, extraFields, typeMismatches } = result;

  if (missingFields.length > 0) {
    console.log(
      `❌ Fehlende Felder: ${missingFields
        .map(stripDataPrefix)
        .join(", ")}`
    );
  }
  if (extraFields.length > 0) {
    console.log(
      `➕ Zusätzliche Felder: ${extraFields
        .map(stripDataPrefix)
        .join(", ")}`
    );
  }
  if (typeMismatches.length > 0) {
    console.log("⚠️ Typabweichungen:");
    typeMismatches.forEach((tm) => {
      console.log(
        `• ${stripDataPrefix(tm.path)}: erwartet ${tm.expected}, erhalten ${tm.actual}`
      );
    });
  }

  return result;
}

module.exports = { runSingleEndpoint };