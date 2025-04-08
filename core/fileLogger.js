//fileLogger.js

const fs = require("fs-extra");
const path = require("path");

/**
 * Schreibt eine generische Log-Nachricht mit Zeitstempel in eine angegebene Datei.
 * Erstellt die Datei, falls sie nicht existiert.
 * 
 * @param {string} filename - Der Dateiname, z. B. "custom.log"
 * @param {string} message - Die Lognachricht
 */
function logToFile(filename, message) {
  const logPath = path.join(__dirname, "..", "logs", filename);
  const timestamp = new Date().toISOString();
  fs.appendFileSync(logPath, `[${timestamp}] ${message}\n`);
}

/**
 * Schreibt eine Fehlermeldung in die Datei "errors.log".
 * Wird z. B. verwendet bei HTTP-Fehlern oder Ausführungsfehlern.
 * 
 * @param {string} endpointName - Der Name des API-Endpunkts
 * @param {string} errorMessage - Die konkrete Fehlermeldung
 */
function logError(endpointName, errorMessage) {
  try {
    const logDir = path.join(__dirname, "..", "logs");
    fs.ensureDirSync(logDir);

    const logMessage = `[${new Date().toISOString()}] Fehler bei ${endpointName}: ${errorMessage}\n\n`;
    fs.appendFileSync(path.join(logDir, "errors.log"), logMessage);
  } catch (error) {
    console.error(`❌ Fehler beim Schreiben in errors.log: ${error.message}`);
  }
}

/**
 * Schreibt erkannte Strukturunterschiede in die Datei "differences.log".
 * Wird z. B. aufgerufen, wenn Felder fehlen oder zusätzlich auftauchen.
 * 
 * @param {string} endpointName - Der API-Endpunkt
 * @param {Array<string>} differences - Liste an Unterschieden als Strings
 */
function logDifferences(endpointName, differences) {
  try {
    if (!differences || differences.length === 0) return;

    const logDir = path.join(__dirname, "..", "logs");
    fs.ensureDirSync(logDir);

    const logMessage = `[${new Date().toISOString()}] Unterschiede bei ${endpointName}:\n${differences.join("\n")}\n\n`;
    fs.appendFileSync(path.join(logDir, "differences.log"), logMessage);
  } catch (error) {
    console.error(`❌ Fehler beim Schreiben in differences.log: ${error.message}`);
  }
}

// Export der Logging-Funktionen für andere Module
module.exports = {
  logToFile,
  logError,
  logDifferences
};