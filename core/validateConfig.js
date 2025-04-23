//validateConfig.js

const fs = require("fs-extra");
const path = require("path");
const { resolveProjectPath } = require("./utils");

/**
 * Validiert, ob alle in der config.json angegebenen Dateien tatsächlich existieren.
 * Gibt Warnungen für fehlende Dateien aus (z. B. request-Bodies oder expected-Strukturen).
 * 
 * @param {Array} endpoints - Liste aller Endpunkte aus der config.json
 */
function validateConfig(endpoints) {
  let hasWarnings = false;

  endpoints.forEach((ep) => {
    // Prüfe: bodyFile (z. B. "requestBodies/create-customer.json")
    if (ep.bodyFile) {
      const bodyPath = resolveProjectPath(ep.bodyFile);
      if (!fs.existsSync(bodyPath)) {
        console.warn(`⚠️ Warnung: Datei fehlt → ${ep.bodyFile} (${ep.name})`);
        hasWarnings = true;
      }
    }

    // Prüfe: expectedStructure (z. B. "expected/Get_View_Customer.json")
    if (ep.expectedStructure) {
      const expectedPath = resolveProjectPath(ep.expectedStructure);
      if (!fs.existsSync(expectedPath)) {
        console.warn(`⚠️ Warnung: Datei fehlt → ${ep.expectedStructure} (${ep.name})`);
        hasWarnings = true;
      }
    }
  });

  if (!hasWarnings) {
    console.log("\n✅ Alle Referenzen in config.json vorhanden.\n");
  }
}

module.exports = { validateConfig };