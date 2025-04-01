// validateConfig.js

const fs = require("fs-extra");
const path = require("path");

function validateConfig(endpoints) {
  let hasWarnings = false;

  endpoints.forEach((ep) => {
    if (ep.bodyFile) {
      const bodyPath = path.join(__dirname, "..", ep.bodyFile);
      if (!fs.existsSync(bodyPath)) {
        console.warn(`⚠️ Warnung: Datei fehlt → ${ep.bodyFile} (${ep.name})`);
        hasWarnings = true;
      }
    }

    if (ep.expectedStructure) {
      const expectedPath = path.join(__dirname, "..", ep.expectedStructure);
      if (!fs.existsSync(expectedPath)) {
        console.warn(`⚠️ Warnung: Datei fehlt → ${ep.expectedStructure} (${ep.name})`);
        hasWarnings = true;
      }
    }
  });

  if (!hasWarnings) {
    console.log("✅ Alle Referenzen in config.json vorhanden.");
  }
}

module.exports = { validateConfig };