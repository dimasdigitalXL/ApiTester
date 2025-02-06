const fs = require("fs-extra");
const schedule = require("node-schedule");
const querystring = require("querystring");

// Funktion zum Testen eines API-Endpunkts
const path = require("path");

async function testEndpoint(endpoint) {
  try {
    console.log(`Starte Test für Endpunkt: ${endpoint.name}`);

    const queryParams = new URLSearchParams(endpoint.query);
    const response = await fetch(`${endpoint.url}?${queryParams.toString()}`, {
      method: endpoint.method,
      headers: endpoint.headers,
    });

    if (!response.ok) {
      throw new Error(`HTTP-Fehler: ${response.status} ${response.statusText}`);
    }

    const responseData = await response.json();

    // Speichere die Response in einer Datei
    const fileName = `${endpoint.name.replace(/\s+/g, "_")}_response.json`;
    const filePath = path.join(__dirname, "responses", fileName);
    fs.writeFileSync(filePath, JSON.stringify(responseData, null, 2));
    console.log(`Response für ${endpoint.name} gespeichert unter: ${filePath}`);

    const expectedStructure = await fs.readJson(endpoint.expectedStructure);
    const differences = compareStructures(expectedStructure, responseData);

    if (differences.length > 0) {
      console.warn(`WARNUNG: Unterschiede bei ${endpoint.name}`);
      console.log("Unterschiede:", differences.join("\n"));
      logDifferences(endpoint.name, differences);
    } else {
      console.log(`${endpoint.name}: Struktur ist korrekt.`);
    }
  } catch (error) {
    console.error(`Fehler bei ${endpoint.name}: ${error.message}`);
    logError(endpoint.name, error.message);
  }
}

// Funktion zum Vergleichen der Datenstruktur
function compareStructures(expected, actual) {
  const differences = [];

  // Überprüfen, ob Felder fehlen oder Typen nicht übereinstimmen
  for (const key in expected) {
    if (!Object.hasOwn(actual, key)) {
      differences.push(`Fehlendes Feld: ${key}`);
    } else if (typeof actual[key] !== expected[key]) {
      differences.push(
        `Falscher Typ für Feld ${key}: erwartet ${expected[key]}, erhalten ${typeof actual[key]}`
      );
    }
  }

  // Zusätzliche Felder in der Response prüfen
  for (const key in actual) {
    if (!Object.hasOwn(expected, key)) {
      differences.push(`Neues Feld gefunden: ${key}`);
    }
  }

  return differences;
}

// Fehler protokollieren
function logError(endpointName, errorMessage) {
  const logMessage = `[${new Date().toISOString()}] Fehler bei ${endpointName}: ${errorMessage}\n`;
  fs.appendFileSync("logs/errors.log", logMessage);
}

// Unterschiede protokollieren
function logDifferences(endpointName, differences) {
  const logMessage = `[${new Date().toISOString()}] Unterschiede bei ${endpointName}:\n${differences.join(
    "\n"
  )}\n`;
  fs.appendFileSync("logs/differences.log", logMessage);
}

// Hauptfunktion
async function main() {
  try {
    console.log("Lade Config-Datei...");
    const config = await fs.readJson("config.json");
    const endpoints = config.endpoints;

    console.log(`Starte API-Tests um ${new Date().toISOString()}`);

    // API-Endpunkte iterieren und testen
    for (const endpoint of endpoints) {
      await testEndpoint(endpoint);
    }

    console.log("Alle Tests abgeschlossen.");
  } catch (error) {
    console.error("Fehler beim Ausführen des Skripts:", error.message);
  }
}

// Zeitgesteuerte Ausführung konfigurieren
const config = fs.readJsonSync("config.json");
schedule.scheduleJob(config.schedule, main);

// Direktes Ausführen, wenn das Skript gestartet wird
if (require.main === module) {
  main();
}

