// configLoader.js

const fs = require("fs-extra");

async function loadConfig() {
  try {
    const config = await fs.readJson("config.json");
    return config.endpoints || [];
  } catch (error) {
    console.error("❌ Fehler beim Laden der Konfigurationsdatei:", error.message);
    process.exit(1);
  }
}

module.exports = { loadConfig };
