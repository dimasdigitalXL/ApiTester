const fs = require("fs-extra");
const path = require("path");

/**
 * Validiert, ob alle in der config.json angegebenen Dateien tatsächlich existieren.
 * Gibt Warnungen für fehlende Dateien aus (z. B. request-Bodies oder expected-Strukturen).
 * 
 * @param {Array} endpoints - Liste aller Endpunkte aus der config.json
 */
function validateConfig(endpoints) {
  let hasWarnings = false;

  endpoints.forEach((ep) => {
    // Überprüfe, ob die angegebene bodyFile existiert (z. B. POST request body)
    if (ep.bodyFile) {
      const bodyPath = path.join(__dirname, "..", ep.bodyFile);
      if (!fs.existsSync(bodyPath)) {
        console.warn(`⚠️ Warnung: Datei fehlt → ${ep.bodyFile} (${ep.name})`);
        hasWarnings = true;
      }
    }

    // Überprüfe, ob die angegebene expectedStructure-Datei existiert
    if (ep.expectedStructure) {
      const expectedPath = path.join(__dirname, "..", ep.expectedStructure);
      if (!fs.existsSync(expectedPath)) {
        console.warn(`⚠️ Warnung: Datei fehlt → ${ep.expectedStructure} (${ep.name})`);
        hasWarnings = true;
      }
    }
  });

  // Erfolgsnachricht, wenn keine Warnungen gefunden wurden
  if (!hasWarnings) {
    console.log("✅ Alle Referenzen in config.json vorhanden.");
  }
}

module.exports = { validateConfig };