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

  // Prüfen, ob eines der Objekte ein Array ist und das andere nicht
  if (Array.isArray(expected) !== Array.isArray(actual)) {
    typeMismatches.push(
      `Typen stimmen nicht überein bei ${path || "root"}: erwartet ${
        Array.isArray(expected) ? "Array" : "Object"
      }, erhalten ${Array.isArray(actual) ? "Array" : "Object"}`
    );
    return { missingFields, extraFields, typeMismatches };
  }

  // Falls das erwartete Objekt ein Array ist, prüfen wir die Elemente
  if (Array.isArray(expected)) {
    if (actual.length === 0) {
      return { missingFields, extraFields, typeMismatches }; // Kein Fehler, wenn `actual` leer ist
    }

    for (let i = 0; i < expected.length; i++) {
      const result = compareStructures(expected[0], actual[i], `${path}[${i}]`);
      missingFields.push(...result.missingFields);
      extraFields.push(...result.extraFields);
      typeMismatches.push(...result.typeMismatches);
    }
    return { missingFields, extraFields, typeMismatches };
  }

  // Überprüfen, ob Felder fehlen oder Typen nicht übereinstimmen
  for (const key in expected) {
    if (!Object.hasOwn(actual, key)) {
      missingFields.push(`${path ? path + "." : ""}${key}`);
    } else {
      const expectedValue = expected[key];
      const actualValue = actual[key];
      const expectedType = typeof expectedValue;
      const actualType = typeof actualValue;

      // Erlaube `null` für bestimmte erwartete Typen
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

      // Falls der Wert ein Objekt ist, rekursiv weiter prüfen
      if (expectedType === "object" && expectedValue !== null && actualValue !== null) {
        const result = compareStructures(expectedValue, actualValue, `${path ? path + "." : ""}${key}`);
        missingFields.push(...result.missingFields);
        extraFields.push(...result.extraFields);
        typeMismatches.push(...result.typeMismatches);
      }
    }
  }

  // Prüfen, ob es zusätzliche Felder in der API-Response gibt
  for (const key in actual) {
    if (!Object.hasOwn(expected, key)) {
      extraFields.push(`${path ? path + "." : ""}${key}`);
    }
  }

  return {
    missingFields: missingFields.map((f) => f.replace(/^data\./, "")), // Entfernt "data." für bessere Anzeige
    extraFields: extraFields.map((f) => f.replace(/^data\./, "")), // Entfernt "data."
    typeMismatches,
  };  
}

// Funktion für API-Endpunkte: führt den Request aus und vergleicht das Ergebnis mit der erwarteten Struktur
async function testEndpoint(endpoint, dynamicParams = {}, retryCount = 0) {
  try {
    if (endpoint.requiresId && (!dynamicParams.id || dynamicParams.id.trim() === "")) {
      throw new Error(`Der Endpunkt "${endpoint.name}" benötigt eine ID, aber keine wurde angegeben.`);
    }

    if (!process.env.XENTRAL_ID) {
      throw new Error("Fehler: XENTRAL_ID ist nicht definiert.");
    }
    
    let url = endpoint.url.replace("${XENTRAL_ID}", process.env.XENTRAL_ID);

    for (const param in dynamicParams) {
      if (url.includes(`{${param}}`)) {
        url = url.replace(`{${param}}`, dynamicParams[param]);
      }
    }
    
    if (url.includes("{id}")) {
      throw new Error(`Fehler: Die ID wurde nicht korrekt ersetzt! URL: ${url}`);
    }

    const queryParams = new URLSearchParams(endpoint.query || {});
    let body = null;

    if (["POST", "PUT", "PATCH", "DELETE"].includes(endpoint.method)) {
      if (endpoint.bodyFile) {
        const bodyPath = path.join(__dirname, endpoint.bodyFile);
        if (fs.existsSync(bodyPath)) {
          body = fs.readJsonSync(bodyPath);
        } else {
          throw new Error(`Fehler: Die Datei für den Request-Body existiert nicht: ${bodyPath}`);
        }
      } else if (endpoint.method === "DELETE") {
        body = null;
      }
    }

    const response = await fetch(`${url}?${queryParams.toString()}`, {
      method: endpoint.method,
      headers: {
        Authorization: `Bearer ${process.env.BEARER_TOKEN}`,
        "Content-Type": "application/json",
        Accept: endpoint.headers?.Accept || "application/vnd.xentral.VARIANT.v1+json" // Standard v1, falls nichts anderes gesetzt ist
      },
      body: body ? JSON.stringify(body) : (endpoint.method === "DELETE" ? null : undefined)
    });    

    if ([500, 502, 503].includes(response.status) && retryCount < 3) {
      return testEndpoint(endpoint, dynamicParams, retryCount + 1);
    }

    if (!response.ok) {
      let errorText;
      try {
        errorText = await response.json();
      } catch {
        errorText = await response.text();
      }
      throw new Error(`HTTP-Fehler: ${response.status} - ${JSON.stringify(errorText)}`);
    }

    const contentType = response.headers.get("content-type") || "";
    let responseData = {};

    if (contentType.includes("json")) {
      try {
        responseData = await response.json();
        if (responseData && Object.keys(responseData).length > 0) {
          const responseDir = path.join(__dirname, "responses");
          if (!fs.existsSync(responseDir)) {
            fs.mkdirSync(responseDir, { recursive: true });
          }
          const responseFilePath = path.join(responseDir, `${endpoint.name.replace(/\s+/g, "_")}_response.json`);
          fs.writeFileSync(responseFilePath, JSON.stringify(responseData, null, 2));
        }
      } catch (error) {
        console.error(`Fehler beim Parsen der API-Response: ${error.message}`);
      }
    } else {
      responseData = {};
    }

    if (endpoint.method === "DELETE") {
      return {
        endpointName: endpoint.name,
        method: endpoint.method,
        success: response.ok,
        isCritical: !response.ok,
        statusCode: response.status,
        errorMessage: response.ok ? null : `Fehlercode: ${response.status}`,
        missingFields: [],
        extraFields: []
      };
    }

    if (["POST", "PUT", "PATCH"].includes(endpoint.method)) {
      return {
        endpointName: endpoint.name,
        method: endpoint.method,
        success: response.status >= 200 && response.status < 300,
        isCritical: response.status >= 400,
        statusCode: response.status,
        errorMessage: response.status >= 400 ? `Fehlercode: ${response.status}` : null,
        missingFields: [],
        extraFields: []
      };
    }

    let expectedStructure = null;
    if (endpoint.expectedStructure && fs.existsSync(endpoint.expectedStructure)) {
      expectedStructure = await fs.readJson(endpoint.expectedStructure);
    }

    if (!expectedStructure || typeof expectedStructure !== "object") {
      console.warn(`⚠️ Keine gültige erwartete Struktur für ${endpoint.name}. Strukturvergleich übersprungen.`);
      return {
        endpointName: endpoint.name,
        method: endpoint.method,
        success: true, // Keine Strukturprüfung möglich
        isCritical: false,
        statusCode: response.status,
        errorMessage: null,
        missingFields: [],
        extraFields: []
      };
    }

    let { missingFields, extraFields } = compareStructures(expectedStructure, responseData);

    if (missingFields.length > 0 || extraFields.length > 0) {
      console.log("\n❌ Strukturabweichungen gefunden!\n");

      if (missingFields.length > 0) {
        console.log("🚨 Fehlende Felder:");
        missingFields.forEach(field => console.log(`   ➤ ${field}`));
      }

      if (extraFields.length > 0) {
        console.log("\n🚨 Zusätzliche Felder:");
        extraFields.forEach(field => console.log(`   ➤ ${field}`));
      }
      console.log("");
    } else {
      console.log("\n✅ Struktur der API-Response ist korrekt.\n");
    }

    return {
      endpointName: endpoint.name,
      method: endpoint.method,
      success: missingFields.length === 0 && extraFields.length === 0,
      isCritical: false,
      statusCode: response.status,
      errorMessage: missingFields.length > 0 || extraFields.length > 0 ? "Strukturabweichungen gefunden" : null,
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
      oldAccept: endpoint.headers.Accept,
      newAccept: updatedEndpoint.headers.Accept,
      expectedStructure: endpoint.expectedStructure || null
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

// Erkennt, ob eine neuere API-Version über den Accept-Header verfügbar ist (Xentral verwendet keine Pfad-Versionierung)
async function checkAndUpdateApiVersion(endpoint, dynamicParams = {}) {
  const headerRegex = /\.v(\d+)(?:-beta|-alpha)?\+json$/;
  const currentAccept = endpoint.headers?.Accept || "application/vnd.xentral.default.v1+json";

  const match = currentAccept.match(headerRegex);
  const currentVersion = match ? parseInt(match[1]) : 1;
  const nextVersion = currentVersion + 1;
  const newAcceptHeader = `application/vnd.xentral.default.v${nextVersion}-beta+json`;

  // URL vorbereiten
  let testUrl = endpoint.url;

  if (!process.env.XENTRAL_ID) {
    console.warn("⚠️ Kein XENTRAL_ID in .env gesetzt – Versionsprüfung übersprungen.");
    return { ...endpoint, versionChanged: false };
  }

  // Ersetze XENTRAL_ID Platzhalter
  testUrl = testUrl.replace("${XENTRAL_ID}", process.env.XENTRAL_ID);

  // Ersetze dynamische Platzhalter wie {id}, {orderId}, ...
  testUrl = testUrl.replace(/{(.*?)}/g, (match, p1) => {
    const replacement = dynamicParams[p1];
    if (!replacement) {
      console.warn(`⚠️ Platzhalter {${p1}} konnte nicht ersetzt werden – fehlt in Aufrufparametern.`);
      return match; // lasse {id} stehen, damit der Fehler sichtbar ist
    }
    return replacement;
  });

  // Sicherheit: Warnung, falls noch {irgendwas} in URL steht
  if (testUrl.includes("{")) {
    console.warn("⚠️ WARNUNG: Es sind noch unersetzte Platzhalter in der URL:", testUrl);
    return { ...endpoint, versionChanged: false };
  }

  console.log(`🔍 Prüfe neue API-Version mit: ${testUrl}`);
  console.log(`🧾 Verwende Header: ${newAcceptHeader}\n`);

  try {
    const response = await fetch(testUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${process.env.BEARER_TOKEN}`,
        Accept: newAcceptHeader,
        "User-Agent": "Mozilla/5.0 (XentralAPITester)"
      }
    });

    if (response.status === 200) {
      console.log(`✅ API-Version erkannt über Accept-Header: ${newAcceptHeader}`);
      return {
        ...endpoint,
        versionChanged: true,
        headers: {
          ...endpoint.headers,
          Accept: newAcceptHeader
        }
      };
    } else if (response.status === 406 || response.status === 404) {
      console.warn(`⚠️ API-Version ${newAcceptHeader} wird nicht akzeptiert (${response.status} ${response.statusText}).`);
    } else {
      const body = await response.text();
      console.warn(`⚠️ API-Version ${newAcceptHeader} konnte nicht überprüft werden (Status: ${response.status}).`);
      console.warn(`📄 Fehlerinhalt: ${body.substring(0, 300)}...`);
    }

  } catch (error) {
    console.warn(`⚠️ Fehler beim Prüfen der API-Version (${newAcceptHeader}): ${error.message}`);
  }

  return { ...endpoint, versionChanged: false };
}

// Sendet eine strukturierte Slack-Benachrichtigung mit allen Ergebnissen
async function sendSlackReport(testResults, versionUpdates = []) {
  try {
    // Filtere Testergebnisse
    const successCount = testResults.filter(r => r.success).length;
    const warnings = testResults.filter(r =>
      !r.success && !r.isCritical &&
      (r.missingFields.length > 0 || r.extraFields.length > 0)
    );
    const criticals = testResults.filter(r => r.isCritical);

    const totalTests = testResults.length;
    const warningCount = warnings.length;
    const criticalCount = criticals.length;

    let message = `:mag: *API Testbericht - ${new Date().toLocaleDateString()}*\n`;
    message += `---------------------------------------------\n`;

    // Neuer Bereich für automatisch erkannte API-Versionen
    if (versionUpdates.length > 0) {
      message += `:rocket: *Automatisch erkannte neue API-Versionen:*\n\n`;

      versionUpdates.forEach(ep => {
        message += `🔄 *${ep.name}*\n`;
        message += `🧾 Neuer Accept-Header: \`${ep.newAccept}\`\n`;
        if (ep.expectedStructure) {
          message += `⚠ Erwartete Struktur prüfen: \`${ep.expectedStructure}\`\n`;
        } else {
          message += `⚠ Erwartete Struktur nicht verknüpft – bitte manuell prüfen!\n`;
        }
        message += `\n`;
      });

      message += `---------------------------------------------\n`;
    }

    // Fehlerdetails (nur wenn vorhanden)
    if (warnings.length > 0 || criticals.length > 0) {
      message += `:pushpin: *Fehlerdetails:*\n`;
    } else {
      message += `✅ *Alle Tests erfolgreich ausgeführt.* Keine Abweichungen gefunden!\n`;
    }

    // Fehler- oder Warnberichte durchgehen
    let issueCounter = 1;
    [...warnings, ...criticals].forEach(issue => {
      const statusIcon = issue.isCritical ? ":red_circle:" : ":large_orange_circle:";
      message += `\n${issueCounter}️⃣ *${issue.endpointName}* (${issue.method}) ${statusIcon}\n`;

      const formattedMissing = issue.missingFields.map(f => f.replace(/^data\./, ""));
      const formattedExtra = issue.extraFields.map(f => f.replace(/^data\./, ""));

      if (formattedMissing.length > 0) {
        message += `:warning: *Fehlende Attribute:* ${formattedMissing.join(", ")}\n`;
      }
      if (formattedExtra.length > 0) {
        message += `:warning: *Neue Attribute:* ${formattedExtra.join(", ")}\n`;
      }
      if (issue.isCritical && issue.errorMessage) {
        message += `:x: *Fehlermeldung:* ${issue.errorMessage}\n`;
      }

      issueCounter++;
    });

    if (warnings.length > 0 || criticals.length > 0) {
      message += `\n`; // optisch trennen
    }

    // Zusammenfassung / Statistik
    message += `:bar_chart: *Gesamtstatistik:* ${totalTests} API-Calls\n`;
    message += `:small_blue_diamond: :large_green_circle: *Erfolgreich:* ${successCount}\n`;
    message += `:small_blue_diamond: :large_orange_circle: *Achtung:* ${warningCount}\n`;
    message += `:small_blue_diamond: :red_circle: *Kritisch:* ${criticalCount}\n`;

    // Status-Symbol nach Schwere
    const statusIcon = criticalCount > 0
      ? ":red_circle:"
      : warningCount > 0
        ? ":large_orange_circle:"
        : ":large_green_circle:";
    message += `:loudspeaker: *Status:* ${statusIcon}\n`;

    // Slack-Webhook aufrufen
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
