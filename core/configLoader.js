//configLoader.js

/**
 * Lädt die Konfigurationsdatei `config.json` und gibt das `endpoints`-Array zurück.
 * Falls die Datei nicht existiert oder ein Fehler beim Parsen auftritt,
 * wird ein Fehler ausgegeben und das Programm beendet.
 * 
 * @returns {Promise<Array>} - Eine Liste aller API-Endpunkte aus der Konfiguration
 */
const fs = require("fs-extra");

async function loadConfig() {
  try {
    const config = await fs.readJson("config.json"); // Lese JSON-Datei synchron ein
    return config; // Gib die Liste der Endpunkte zurück oder leere Liste
  } catch (error) {
    console.error("❌ Fehler beim Laden der Konfigurationsdatei:", error.message);
    process.exit(1); // Programm beenden, da ohne Konfig keine Tests möglich sind
  }
}

module.exports = { loadConfig };
