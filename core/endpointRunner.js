// endpointRunner.js (angepasst auf Zwei-Schritt-Logik)

const path = require("path");
const { promptUserForId } = require("./promptHelper"); // Fragt Benutzer nach einer ID, falls notwendig
const { checkAndUpdateApiVersion } = require("./versionChecker"); // Prüft, ob eine neuere API-Version existiert
const { testEndpoint } = require("./apiCaller"); // Führt den tatsächlichen API-Test aus

/**
 * Entfernt das data-Präfix aus einem Feldpfad für saubere Konsolenanzeige
 * z.B. data.positions.tax.rate → positions.tax.rate
 */
function stripDataPrefix(str) {
  return str.replace(/^data\[0\]\./, "").replace(/^data\./, "");
}

/**
 * Führt einen einzelnen API-Test aus
 * - Prüft, ob eine neue Version vorhanden ist (Zwei-Schritt-Logik)
 * - Führt im zweiten Schritt den Strukturvergleich und Test durch
 */
async function runSingleEndpoint(endpoint, config, versionUpdates, dynamicParamsOverride = {}) {
  // Falls der Endpunkt eine ID erfordert, prüfe, ob sie übergeben wurde oder in default-ids.json vorhanden ist
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

  // Prüfe, ob es eine neue API-Version für den Endpunkt gibt
  const updatedEndpoint = await checkAndUpdateApiVersion(endpoint, dynamicParamsOverride);

  // Wenn eine neue Version erkannt wurde:
  if (updatedEndpoint.versionChanged) {
    versionUpdates.push({
      name: endpoint.name,
      url: updatedEndpoint.url,
      expectedStructure: endpoint.expectedStructure
    });

    // Speichere die aktualisierte URL im config-Objekt
    const index = config.endpoints.findIndex(ep => ep.name === endpoint.name);
    if (index !== -1) config.endpoints[index] = updatedEndpoint;

    // → Breche hier ab: Test wird im **nächsten Durchlauf** durchgeführt (2-Schritt-Logik)
    return null;
  }

  // Jetzt: Strukturvergleich und Datentypprüfung mit der (ggf. aktualisierten) API-Version
  const result = await testEndpoint(updatedEndpoint, dynamicParamsOverride, config);

  const { missingFields, extraFields, typeMismatches } = result;

  // Anzeige der fehlenden Felder
  if (missingFields.length > 0) {
    const cleaned = missingFields.map(stripDataPrefix);
    console.log(`❌ Fehlende Felder: ${cleaned.join(", ")}`);
  }

  // Anzeige zusätzlicher (unerwarteter) Felder
  if (extraFields.length > 0) {
    const cleaned = extraFields.map(stripDataPrefix);
    console.log(`➕ Zusätzliche Felder: ${cleaned.join(", ")}`);
  }

  // Anzeige von Typabweichungen
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