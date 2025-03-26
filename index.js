require("dotenv").config();
const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
const { appendFileSync } = require("fs");

console.log("BEARER_TOKEN aus .env:", process.env.BEARER_TOKEN);
console.log("XENTRAL_ID aus .env:", process.env.XENTRAL_ID);

const readline = require("readline");

let defaultIds = {};
try {
  // Versuche, die Datei mit Default-IDs zu laden (optional)
  defaultIds = fs.readJsonSync("default-ids.json");
  console.log("📄 default-ids.json geladen.");
} catch {
  console.warn("⚠️ Keine default-ids.json gefunden oder nicht lesbar.");
}

// Funktion zum Speichern von Logs
function logToFile(filename, message) {
    const logPath = path.join(__dirname, "logs", filename);
    const timestamp = new Date().toISOString();
    appendFileSync(logPath, `[${timestamp}] ${message}\n`);
}

// Funktion zum Vergleichen der Datenstruktur zwischen der erwarteten und der tatsächlichen API-Response
function compareStructures(expected, actual, path = "") {
  const missingFields = [];
  const extraFields = [];
  const typeMismatches = [];

  if (!expected || !actual || typeof expected !== "object" || typeof actual !== "object") {
    console.error("❌ Fehler: Erwartete oder tatsächliche Struktur ist ungültig.");
    console.log("🔍 Erwartete Struktur:", JSON.stringify(expected, null, 2));
    console.log("🔍 Tatsächliche API-Response:", JSON.stringify(actual, null, 2));
    return { missingFields, extraFields, typeMismatches };
  }

  if (Array.isArray(expected) !== Array.isArray(actual)) {
    typeMismatches.push(
      `Typen stimmen nicht überein bei ${path || "root"}: erwartet ${
        Array.isArray(expected) ? "Array" : "Object"
      }, erhalten ${Array.isArray(actual) ? "Array" : "Object"}`
    );
    return { missingFields, extraFields, typeMismatches };
  }

  if (Array.isArray(expected)) {
    if (actual.length === 0) return { missingFields, extraFields, typeMismatches };

    for (let i = 0; i < expected.length; i++) {
      const result = compareStructures(expected[0], actual[i], path);
      missingFields.push(...result.missingFields);
      extraFields.push(...result.extraFields);
      typeMismatches.push(...result.typeMismatches);
    }
    return { missingFields, extraFields, typeMismatches };
  }

  for (const key in expected) {
    if (!Object.hasOwn(actual, key)) {
      missingFields.push(`${path ? path + "." : ""}${key}`);
    } else {
      const expectedValue = expected[key];
      const actualValue = actual[key];
      const expectedType = typeof expectedValue;
      const actualType = typeof actualValue;

      const isNullableString = expectedValue === "string|null" && (actualValue === null || actualType === "string");
      const isNullableNumber = expectedValue === "number|null" && (actualValue === null || actualType === "number");
      const isNullableBoolean = expectedValue === "boolean|null" && (actualValue === null || actualType === "boolean");
      const isNullableObject = expectedValue && expectedType === "object" && actualValue === null;

      if (
        actualValue !== null &&
        expectedType !== "object" &&
        actualType !== expectedType &&
        !isNullableString &&
        !isNullableNumber &&
        !isNullableBoolean &&
        !isNullableObject
      ) {
        typeMismatches.push(`${path ? path + "." : ""}${key}: erwartet ${expectedType}, erhalten ${actualType}`);
      }

      if (expectedType === "object" && expectedValue !== null && actualValue !== null) {
        const result = compareStructures(expectedValue, actualValue, `${path ? path + "." : ""}${key}`);
        missingFields.push(...result.missingFields);
        extraFields.push(...result.extraFields);
        typeMismatches.push(...result.typeMismatches);
      }
    }
  }

  for (const key in actual) {
    if (!Object.hasOwn(expected, key)) {
      extraFields.push(`${path ? path + "." : ""}${key}`);
    }
  }

  // Entferne "data[0]." für saubere Slack-Ausgabe
  const cleanPath = (entry) => entry.replace(/^data\[0\]\./, "");

  return {
    // Entfernt "data[0]." und "data." aus den Pfaden für bessere Lesbarkeit in Konsole & Slack
    missingFields: missingFields.map(f => f.replace(/^data\[0\]\./, "").replace(/^data\./, "")),
    extraFields: extraFields.map(f => f.replace(/^data\[0\]\./, "").replace(/^data\./, "")),
    typeMismatches
  };  
}

// Funktion für API-Endpunkte: führt den Request aus und vergleicht das Ergebnis mit der erwarteten Struktur
async function testEndpoint(endpoint, dynamicParams = {}, retryCount = 0) {
  try {
    // Prüfe, ob eine ID notwendig ist, aber nicht vorhanden
    if (endpoint.requiresId && (!dynamicParams.id || dynamicParams.id.trim() === "")) {
      throw new Error(`Der Endpunkt "${endpoint.name}" benötigt eine ID, aber keine wurde angegeben.`);
    }

    if (!process.env.XENTRAL_ID) {
      throw new Error("Fehler: XENTRAL_ID ist nicht definiert.");
    }

    // URL mit Platzhaltern ersetzen
    let url = endpoint.url.replace("${XENTRAL_ID}", process.env.XENTRAL_ID);
    for (const param in dynamicParams) {
      url = url.replace(`{${param}}`, dynamicParams[param]);
    }

    // Query-Parameter anhängen
    const queryParams = new URLSearchParams(endpoint.query || {});
    let body = null;

    // Falls ein Body benötigt wird (POST, PUT, PATCH)
    if (["POST", "PUT", "PATCH"].includes(endpoint.method) && endpoint.bodyFile) {
      const bodyPath = path.join(__dirname, endpoint.bodyFile);
      if (fs.existsSync(bodyPath)) {
        body = fs.readJsonSync(bodyPath);
      } else {
        throw new Error(`Fehler: Die Datei für den Request-Body existiert nicht: ${bodyPath}`);
      }
    }

    // Request abschicken
    const response = await fetch(`${url}?${queryParams.toString()}`, {
      method: endpoint.method,
      headers: {
        Authorization: `Bearer ${process.env.BEARER_TOKEN}`,
        Accept: endpoint.headers?.Accept || "application/json",
        ...(endpoint.method !== "GET" && { "Content-Type": "application/json" })
      },
      body: body ? JSON.stringify(body) : undefined
    });

    // Wiederholung bei Serverfehler (max. 3x)
    if ([500, 502, 503].includes(response.status) && retryCount < 3) {
      return testEndpoint(endpoint, dynamicParams, retryCount + 1);
    }

    // 📦 Body ein einziges Mal lesen (wichtig!)
    let responseText;
    try {
      responseText = await response.text();
    } catch (err) {
      console.warn(`⚠️ Antwort konnte nicht gelesen werden: ${err.message}`);
      responseText = "";
    }

    // ❗ Falls Request fehlschlägt
    if (!response.ok) {
      throw new Error(`HTTP-Fehler: ${response.status} - ${responseText}`);
    }

    // 🚀 Versuche, die Antwort als JSON zu parsen
    let responseData = {};
    try {
      responseData = JSON.parse(responseText);
    } catch {
      console.warn("⚠️ Antwort ist kein gültiges JSON.");
    }

    // Speichere Response (falls sinnvoll)
    if (responseData && Object.keys(responseData).length > 0) {
      const responseDir = path.join(__dirname, "responses");
      if (!fs.existsSync(responseDir)) fs.mkdirSync(responseDir, { recursive: true });
      const responseFilePath = path.join(responseDir, `${endpoint.name.replace(/\s+/g, "_")}_response.json`);
      fs.writeFileSync(responseFilePath, JSON.stringify(responseData, null, 2));
    }

    // Für DELETE oder POST/PUT/PATCH gibt es keinen Strukturvergleich
    if (["DELETE", "POST", "PUT", "PATCH"].includes(endpoint.method)) {
      return {
        endpointName: endpoint.name,
        method: endpoint.method,
        success: response.ok,
        isCritical: !response.ok,
        statusCode: response.status,
        errorMessage: !response.ok ? `Fehlercode: ${response.status}` : null,
        missingFields: [],
        extraFields: []
      };
    }

    // Strukturvergleich starten
    let expectedStructure = null;
    if (endpoint.expectedStructure && fs.existsSync(endpoint.expectedStructure)) {
      expectedStructure = await fs.readJson(endpoint.expectedStructure);
    }

    if (!expectedStructure) {
      console.warn(`⚠️ Keine gültige erwartete Struktur für ${endpoint.name}. Strukturvergleich übersprungen.`);
      return {
        endpointName: endpoint.name,
        method: endpoint.method,
        success: true,
        isCritical: false,
        statusCode: response.status,
        errorMessage: null,
        missingFields: [],
        extraFields: []
      };
    }

    const { missingFields, extraFields, typeMismatches } = compareStructures(expectedStructure, responseData);

    if (missingFields.length > 0 || extraFields.length > 0 || typeMismatches.length > 0) {
      console.log(`\n❌ Strukturabweichungen gefunden!\n`);

      if (missingFields.length > 0) {
        console.log("🚨 Fehlende Felder:");
        missingFields.forEach(f => console.log(`   ➤ ${f}`));
      }

      if (extraFields.length > 0) {
        console.log("\n🚨 Zusätzliche Felder:");
        extraFields.forEach(f => console.log(`   ➤ ${f}`));
      }

      if (typeMismatches.length > 0) {
        console.log("\n🚨 Typabweichungen:");
        typeMismatches.forEach(t => console.log(`   ➤ ${t}`));
      }
    } else {
      console.log("\n✅ Struktur der API-Response ist korrekt.\n");
    }

    return {
      endpointName: endpoint.name,
      method: endpoint.method,
      success: missingFields.length === 0 && extraFields.length === 0 && typeMismatches.length === 0,
      isCritical: false,
      statusCode: response.status,
      errorMessage: (missingFields.length > 0 || extraFields.length > 0 || typeMismatches.length > 0)
        ? "Strukturabweichungen gefunden"
        : null,
      missingFields,
      extraFields
    };

  } catch (error) {
    console.error(`❌ Fehler bei ${endpoint.name}: ${error.message}`);
    return {
      endpointName: endpoint.name,
      method: endpoint.method,
      success: false,
      isCritical: true,
      statusCode: null,
      errorMessage: error.message,
      missingFields: [],
      extraFields: []
    };
  }
}

// Fehler protokollieren
function logError(endpointName, errorMessage) {
  try {
    const logDir = path.join(__dirname, "logs");
    fs.ensureDirSync(logDir); // Stellt sicher, dass das Verzeichnis existiert

    const logMessage = `[${new Date().toISOString()}] Fehler bei ${endpointName}: ${errorMessage}\n\n`;
    fs.appendFileSync(path.join(logDir, "errors.log"), logMessage);
  } catch (error) {
    console.error(`❌ Fehler beim Schreiben in errors.log: ${error.message}`);
  }
}

// Unterschiede protokollieren
function logDifferences(endpointName, differences) {
  try {
    if (!differences || differences.length === 0) return; // Falls keine Unterschiede, Logging überspringen

    const logDir = path.join(__dirname, "logs");
    fs.ensureDirSync(logDir); // Stellt sicher, dass das Verzeichnis existiert

    const logMessage = `[${new Date().toISOString()}] Unterschiede bei ${endpointName}:\n${differences.join("\n")}\n\n`;
    fs.appendFileSync(path.join(logDir, "differences.log"), logMessage);
  } catch (error) {
    console.error(`❌ Fehler beim Schreiben in differences.log: ${error.message}`);
  }
}

// Fragt den Benutzer interaktiv nach einer ID
function promptUserForId(message) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question(message, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// Lädt die Konfiguration aus config.json
async function loadConfig() {
  try {
    const config = await fs.readJson("config.json");
    return config.endpoints || [];
  } catch (error) {
    console.error("❌ Fehler beim Laden der Konfigurationsdatei:", error.message);
    process.exit(1);
  }
}

// Führt einen einzelnen API-Test aus (inkl. Versionserkennung & ID-Verwendung)
async function runSingleEndpoint(endpoint, config, versionUpdates, dynamicParamsOverride = {}) {
  if (endpoint.requiresId && !dynamicParamsOverride.id) {
    const defaultId = defaultIds[endpoint.name]; // Prüfe, ob eine ID hinterlegt ist

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

  // Version automatisch erkennen
  const updatedEndpoint = await checkAndUpdateApiVersion(endpoint, dynamicParamsOverride);

  if (updatedEndpoint.versionChanged) {
    versionUpdates.push({
      name: endpoint.name,
      url: updatedEndpoint.url,
      expectedStructure: endpoint.expectedStructure // für Slack-Ausgabe
    });
    
    // Speichere neue Header in config-Objekt im Speicher
    const index = config.endpoints.findIndex(ep => ep.name === endpoint.name);
    if (index !== -1) config.endpoints[index] = updatedEndpoint;
  }

  // Führe eigentlichen API-Test durch
  const result = await testEndpoint(endpoint, dynamicParamsOverride);
  return result;
}

// Führt alle API-Tests durch (Komplettlauf)
async function prepareAndRunAllEndpoints(config) {
  const versionUpdates = [];
  const testResults = [];

  console.log(`🚀 Starte alle API-Tests um ${new Date().toISOString()}\n`);

  for (const endpoint of config.endpoints) {
    // Wichtig: NICHT vorher prüfen, ob requiresId gesetzt ist!
    // → runSingleEndpoint() regelt alles (default-ids.json oder Benutzereingabe)
    const result = await runSingleEndpoint(endpoint, config, versionUpdates);
    if (result) testResults.push(result);
  }

  return { testResults, versionUpdates };
}

// Hauptfunktion für den Einstieg
async function main() {
  const endpoints = await loadConfig();

  const args = process.argv.slice(2);
  const selectedApi = args[0]?.startsWith("--") ? null : args[0];
  const dynamicParams = {};

  args.forEach(arg => {
    const [key, value] = arg.split("=");
    if (key.startsWith("--")) {
      dynamicParams[key.replace("--", "")] = value;
    }
  });

  const config = { endpoints };
  let testResults = [];
  let versionUpdates = [];

  if (selectedApi) {
    console.log(`🚀 Starte gezielten API-Test für: ${selectedApi}\n`);
    const endpoint = endpoints.find(ep => ep.name === selectedApi);

    if (!endpoint) {
      console.error(`❌ Fehler: Kein API-Call mit dem Namen "${selectedApi}" gefunden.\n`);
      return;
    }

    const result = await runSingleEndpoint(endpoint, config, versionUpdates, dynamicParams);
    if (result) testResults.push(result);

  } else {
    // Komplettlauf über ALLE Endpunkte
    const resultObj = await prepareAndRunAllEndpoints(config);
    testResults = resultObj.testResults;
    versionUpdates = resultObj.versionUpdates;
  }

  console.log("\n✅ Alle Tests abgeschlossen.\n");

  if (versionUpdates.length > 0) {
    await fs.writeJson("config.json", config, { spaces: 2 });
    console.log("\n🔄 API-Versionen wurden in der Konfigurationsdatei aktualisiert.\n");
  }

  if (!process.env.DISABLE_SLACK) {
    await sendSlackReport(testResults, versionUpdates);
  } else {
    console.log("\n🔕 Slack-Benachrichtigung ist deaktiviert (DISABLE_SLACK=true).\n");
  }
}

// Diese Funktion erkennt automatisch eine höhere API-Version über die URL.
// Sie ersetzt z. B. /v1/ durch /v2/ und testet, ob diese neue Version gültig ist.
// Wenn sie erfolgreich ist (Status 200), wird die config.json aktualisiert.
// Sobald eine neue Version nicht akzeptiert wird (404, 406 o.ä.), wird der Test abgebrochen.
async function checkAndUpdateApiVersion(endpoint, dynamicParams = {}) {
  const versionRegex = /\/v(\d+)\//;
  const match = endpoint.url.match(versionRegex);
  const currentVersion = match ? parseInt(match[1]) : null;

  // Falls keine Versionsnummer in der URL → keine Prüfung nötig
  if (!currentVersion) {
    return { ...endpoint, versionChanged: false };
  }

  let testedVersion = currentVersion + 1;

  // Teste nur die "nächsthöhere" Version – wenn sie nicht existiert, breche ab
  while (testedVersion <= currentVersion + 5) {
    // Neue URL zusammenbauen (z. B. /v2/ → /v3/)
    const newUrl = endpoint.url.replace(`/v${currentVersion}/`, `/v${testedVersion}/`);

    // Ersetze Platzhalter wie ${XENTRAL_ID} und {id}
    let finalUrl = newUrl.replace("${XENTRAL_ID}", process.env.XENTRAL_ID || "");
    for (const key in dynamicParams) {
      finalUrl = finalUrl.replace(`{${key}}`, dynamicParams[key]);
    }

    console.log(`🔍 Prüfe neue API-Version über URL: ${finalUrl}`);

    try {
      const response = await fetch(finalUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${process.env.BEARER_TOKEN}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": "XentralAPITester"
        }
      });

      if (response.status === 200) {
        // Erfolg: neue Version gefunden → URL aktualisieren
        console.log(`✅ Neue API-Version erkannt: /v${testedVersion}/`);
        const updatedUrl = endpoint.url.replace(`/v${currentVersion}/`, `/v${testedVersion}/`);

        return {
          ...endpoint,
          url: updatedUrl,
          versionChanged: true
        };
      } else {
        // Sobald die erste höhere Version nicht angenommen wird, abbrechen!
        console.warn(`⛔️ Version /v${testedVersion}/ nicht akzeptiert (Status ${response.status}) – Abbruch.`);
        break;
      }

    } catch (error) {
      console.warn(`⚠️ Fehler beim Prüfen von /v${testedVersion}/: ${error.message}`);
      break; // auch bei Netzproblemen oder Fehlern → abbrechen
    }

    testedVersion++;
  }

  // Falls keine neue Version gefunden wurde → Rückgabe wie ursprünglich
  return { ...endpoint, versionChanged: false };
}

// Benachrichtigungsfunktion für Slack (angepasst für URL-basierte Versionen)
async function sendSlackReport(testResults, versionUpdates = []) {
  try {
    const successCount = testResults.filter(r => r.success).length;
    const warnings = testResults.filter(r =>
      !r.success && !r.isCritical && (r.missingFields.length > 0 || r.extraFields.length > 0)
    );
    const criticals = testResults.filter(r => r.isCritical);
    const totalTests = testResults.length;

    const warningCount = warnings.length;
    const criticalCount = criticals.length;

    let message = `:mag: *API Testbericht - ${new Date().toLocaleDateString("de-DE")}*\n`;
    message += `---------------------------------------------\n`;

    // Neue API-Versionen
    if (versionUpdates.length > 0) {
      message += `:rocket: *Automatisch erkannte neue API-Versionen:*\n`;
      versionUpdates.forEach(ep => {
        message += `:arrows_counterclockwise: *${ep.name}*\n`;
        message += `:link: Neue API-URL: ${ep.url}\n`;
        if (ep.expectedStructure) {
          message += `:open_file_folder: *Struktur-Datei:* \`${ep.expectedStructure}\`\n`;
        } else {
          message += `:warning: Erwartete Struktur nicht verknüpft – bitte manuell prüfen!\n`;
        }
      });
      message += `---------------------------------------------\n`;
    }

    // Fehlerdetails
    if (warnings.length > 0 || criticals.length > 0) {
      message += `:pushpin: *Fehlerdetails:*\n`;
    } else {
      message += `:white_check_mark: *Alle Tests erfolgreich ausgeführt.* Keine Abweichungen gefunden!\n`;
    }

    // Auflistung aller Probleme
    let issueCounter = 1;
    [...warnings, ...criticals].forEach(issue => {
      const statusIcon = issue.isCritical ? ":red_circle:" : ":large_orange_circle:";
      message += `\n${issueCounter}️⃣ *${issue.endpointName}* (${issue.method}) ${statusIcon}\n`;

      const stripOnlyDataPrefix = str =>
        str.replace(/^data\[0\]\./, "")
           .replace(/^data\./, "");

      const formattedMissingFields = issue.missingFields.map(stripOnlyDataPrefix);
      const formattedExtraFields = issue.extraFields.map(stripOnlyDataPrefix);
      const formattedTypeMismatches = (issue.typeMismatches || []).map(
        mismatch =>
          `${stripOnlyDataPrefix(mismatch.path)}: erwartet ${mismatch.expected}, erhalten ${mismatch.actual}`
      );

      if (formattedMissingFields.length > 0) {
        message += `:warning: *Fehlende Attribute:* ${formattedMissingFields.join(", ")}\n`;
      }

      if (formattedExtraFields.length > 0) {
        message += `:warning: *Neue Attribute:* ${formattedExtraFields.join(", ")}\n`;
      }

      if (formattedTypeMismatches.length > 0) {
        message += `:straight_ruler: *Typabweichungen:*\n• ${formattedTypeMismatches.join("\n• ")}\n`;
      }

      if (issue.isCritical && issue.errorMessage) {
        message += `:x: *Fehlermeldung:* ${issue.errorMessage}\n`;
      }

      issueCounter++;
    });

    if (warnings.length > 0 || criticals.length > 0) {
      message += `\n`; // Leerzeile nach Fehlerdetails
    }

    // Zusammenfassung
    message += `---------------------------------------------\n`;
    message += `:bar_chart: *Gesamtstatistik:* ${totalTests} API-Calls\n`;
    message += `:small_blue_diamond: :large_green_circle: *Erfolgreich:* ${successCount}\n`;
    message += `:small_blue_diamond: :large_orange_circle: *Achtung:* ${warningCount}\n`;
    message += `:small_blue_diamond: :red_circle: *Kritisch:* ${criticalCount}\n`;
    message += `:loudspeaker: *Status:* ${criticalCount > 0 ? ":red_circle:" : warningCount > 0 ? ":large_orange_circle:" : ":large_green_circle:"}\n`;

    await axios.post(process.env.SLACK_WEBHOOK_URL, { text: message });
    console.log("\n📩 Slack-Testbericht erfolgreich gesendet.");
  } catch (error) {
    console.error("\n❌ Fehler beim Senden des Slack-Berichts:", error.message);
  }
}

// Direktes Ausführen, wenn das Skript gestartet wird
if (require.main === module) {
  main();
}
