// fileLogger.js

const fs = require("fs-extra");
const path = require("path");

function logToFile(filename, message) {
  const logPath = path.join(__dirname, "..", "logs", filename);
  const timestamp = new Date().toISOString();
  fs.appendFileSync(logPath, `[${timestamp}] ${message}\n`);
}

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

module.exports = {
  logToFile,
  logError,
  logDifferences
};
