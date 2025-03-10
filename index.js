require("dotenv").config();
const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
const { appendFileSync } = require("fs");

console.log("BEARER_TOKEN aus .env:", process.env.BEARER_TOKEN);
console.log("XENTRAL_ID aus .env:", process.env.XENTRAL_ID);

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
    console.log("🔍 Tatsächliche API-Response:", JSON.stringify(responseData, null, 2));
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
    missingFields: missingFields.map((f) => f.replace(/^data\[0]\./, "")), // Entfernt "data[0]." für eine bessere Anzeige
    extraFields: extraFields.map((f) => f.replace(/^data\[0]\./, "")), // Entfernt "data[0]."
    typeMismatches,
  };
}

// Funktion für API-Endpunkte: führt den Request aus und vergleicht das Ergebnis mit der erwarteten Struktur
async function testEndpoint(endpoint, dynamicParams = {}) {
  try {
    console.log(`\n🔍 Starte Test für Endpunkt: ${endpoint.name}\n`);

    if (endpoint.requiresId && (!dynamicParams.id || dynamicParams.id.trim() === "")) {
      throw new Error(`Der Endpunkt "${endpoint.name}" benötigt eine ID, aber keine wurde angegeben.`);
    }

    if (!process.env.XENTRAL_ID) {
      throw new Error("❌ Fehler: XENTRAL_ID ist nicht definiert. Prüfe deine .env-Datei.");
    }
    
    let url = endpoint.url.replace("${XENTRAL_ID}", process.env.XENTRAL_ID);
    
    for (const param in dynamicParams) {
      url = url.replace(`{${param}}`, dynamicParams[param]);
    }

    const queryParams = new URLSearchParams(endpoint.query || {});
    let body = null;

    // Falls der Request-Body aus einer Datei geladen werden muss (bei POST, PUT, PATCH, DELETE)
    if (["POST", "PUT", "PATCH", "DELETE"].includes(endpoint.method)) {
      if (endpoint.bodyFile) {
          const bodyPath = path.join(__dirname, endpoint.bodyFile);
          if (fs.existsSync(bodyPath)) {
              body = fs.readJsonSync(bodyPath);
          } else {
              throw new Error(`❌ Fehler: Die Datei für den Request-Body existiert nicht: ${bodyPath}`);
          }
      } else if (endpoint.method === "DELETE") {
          body = null; // DELETE-Requests haben oft keinen Body
      }
  }

    // API-Request durchführen
    const response = await fetch(`${url}?${queryParams.toString()}`, {
      method: endpoint.method,
      headers: {
          ...endpoint.headers,
          Authorization: `Bearer ${process.env.BEARER_TOKEN}`,
          "Content-Type": "application/json"
      },
      body: body ? JSON.stringify(body) : (endpoint.method === "DELETE" ? null : undefined)
    });

    if ([500, 502, 503].includes(response.status) && retryCount < 3) {
      console.warn(`⚠️ API-Fehler ${response.status}. Wiederhole Anfrage (${retryCount + 1}/3)...`);
      return testEndpoint(endpoint, dynamicParams, retryCount + 1);
    }
  
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ API-Fehler: ${response.status} ${response.statusText} - Antwort: ${errorText}`);
      throw new Error(`HTTP-Fehler: ${response.status} ${response.statusText}`);
    }    
  
    let responseData = null;
    const contentType = response.headers.get("content-type") || "";

    // Falls JSON-Response, dann verarbeiten
    if (contentType.includes("application/json")) {
      responseData = await response.json();
    
      // Speicherort für die Response-Datei
      const responseFilePath = path.join(__dirname, "responses", `${endpoint.name.replace(/\s+/g, "_")}_response.json`);
    
      // Debugging-Log für den Speicherpfad
      console.log(`📝 Speichere API-Response in: ${responseFilePath}\n`);
    
      // API-Response speichern
      fs.writeFileSync(responseFilePath, JSON.stringify(responseData, null, 2));
    
      console.log("✅ API-Response erfolgreich gespeichert!\n");
    }

    // Falls keine Antwort vorhanden ist
    if (!responseData) {
      console.warn(`⚠️ Keine API-Response zum Speichern für ${endpoint.name}.`);
      responseData = {};
    }

    // Falls DELETE, ignorieren wir den Strukturvergleich
    if (endpoint.method === "DELETE") {
      console.warn(`⚠️ Erwartete Struktur für ${endpoint.name} wird ignoriert (DELETE-Request).`);
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

    // Falls der Endpunkt ein POST, PUT oder PATCH ist, brauchen wir keine Strukturvalidierung
    if (["POST", "PUT", "PATCH"].includes(endpoint.method)) {
      return {
          endpointName: endpoint.name,
          method: endpoint.method,
          success: response.status >= 200 && response.status < 300, // Erfolg bei 2xx-Statuscodes
          isCritical: response.status >= 400, // Fehlerhaft bei 4xx+
          statusCode: response.status,
          errorMessage: response.status >= 400 ? `Fehlercode: ${response.status}` : null,
          missingFields: [],
          extraFields: []
      };
  }
  
    // Erwartete Struktur laden
    let expectedStructure = null;
    if (endpoint.expectedStructure && fs.existsSync(endpoint.expectedStructure)) {
      expectedStructure = await fs.readJson(endpoint.expectedStructure);
      console.log("📂 Erwartete Struktur geladen.\n");
    }

    // Falls keine erwartete Struktur vorhanden ist
    if (!expectedStructure || typeof expectedStructure !== "object") {
      if (endpoint.method === "DELETE") {
          console.warn(`⚠️ Erwartete Struktur für ${endpoint.name} wird ignoriert (DELETE-Request).`);
      } else {
          console.error(`❌ Fehler: Erwartete Struktur für ${endpoint.name} konnte nicht geladen werden.`);
          return {
              endpointName: endpoint.name,
              method: endpoint.method,
              success: false,
              isCritical: true,
              statusCode: response.status,
              errorMessage: "Erwartete Struktur fehlt",
              missingFields: [],
              extraFields: []
          };
      }
  }

    // Strukturvergleich durchführen
    let missingFields = [];
    let extraFields = [];

    console.log("🔍 Strukturvergleich gestartet...");
    ({ missingFields, extraFields } = compareStructures(expectedStructure, responseData));

    console.log("🔎 Debug: missingFields:", missingFields);
    console.log("🔎 Debug: extraFields:", extraFields);

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
  
      console.log(""); // Fügt eine Leerzeile für bessere Lesbarkeit hinzu
  } else {
      console.log("\n✅ Struktur der API-Response ist korrekt.\n");
  }  

    if (expectedStructure && responseData && typeof responseData === "object") {
        ({ missingFields, extraFields } = compareStructures(expectedStructure, responseData));
    } 
    if (!responseData || typeof responseData !== "object") {
      console.error("❌ Fehler: API-Response ist leer oder kein gültiges Objekt");
      return {
          endpointName: endpoint.name,
          method: endpoint.method,
          success: false,
          isCritical: true,
          statusCode: response.status,
          errorMessage: "Ungültige API-Response",
          missingFields: [],
          extraFields: []
      };
    }

    const result = {
      endpointName: endpoint.name,
      method: endpoint.method,
      success: missingFields.length === 0 && extraFields.length === 0,
      isCritical: false,
      statusCode: response.status,
      errorMessage: missingFields.length > 0 || extraFields.length > 0 ? "Strukturabweichungen gefunden" : null,
      missingFields,
      extraFields
  };
  
  // Logge erfolgreiche API-Tests
  logToFile("test-results.log", `✅ Erfolgreich getestet: ${endpoint.name} (${response.status})`);
  
  return result;  

  } catch (error) {
    console.error("\n❌ FEHLER:\n", error.message);
    
    // Logge Fehler in errors.log
    logToFile("errors.log", `❌ Fehler bei ${endpoint.name}: ${error.message}`);

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

// Hauptfunktion, die alle API-Tests ausführt
async function main() {
  try {
    console.log("\n📂 Lade Config-Datei...\n");
    const config = await fs.readJson("config.json");
    const endpoints = config.endpoints;

    const args = process.argv.slice(2);
    const selectedApi = args[0]?.startsWith("--") ? null : args[0]; // Prüft, ob ein API-Name übergeben wurde
    const dynamicParams = {};

    // Verarbeite Argumente wie --id=123, --deleteId=456, --updateId=789
    args.forEach(arg => {
      const [key, value] = arg.split("=");
      if (key.startsWith("--")) {
        dynamicParams[key.replace("--", "")] = value;
      }
    });

    // IDs für verschiedene API-Calls
    let firstOrderId = dynamicParams.id || null; // Für "Get SalesOrder View"
    let deleteId = dynamicParams.deleteId || null; // Für "Delete Product"
    let updateId = dynamicParams.updateId || null; // Für "Update Product"

    let testResults = []; // Hier speichern wir alle Testergebnisse

    if (selectedApi) {
      console.log(`🚀 Starte gezielten API-Test für: ${selectedApi}\n`);
      const endpoint = endpoints.find(ep => ep.name === selectedApi);
      if (endpoint) {
        const result = await testEndpoint(endpoint, dynamicParams);
        testResults.push(result);
      } else {
        console.error(`❌ Fehler: Kein API-Call mit dem Namen "${selectedApi}" gefunden.\n`);
      }
    } else {
      console.log(`🚀 Starte alle API-Tests um ${new Date().toISOString()}\n`);

      for (const endpoint of endpoints) {
        if (endpoint.name === "Get SalesOrders List" && !firstOrderId) {
          // Falls keine ID übergeben wurde, versuchen, sie aus SalesOrders List zu holen
          const responseData = await testEndpoint(endpoint);
          testResults.push(responseData);
          if (responseData?.data?.length > 0) {
            firstOrderId = responseData.data[0].id;
            console.log(`🔗 Gefundene SalesOrder ID für Detailansicht: ${firstOrderId}\n`);
          }
        } else if (endpoint.name === "Get SalesOrder View") {
          // Falls eine ID vorhanden ist (durch --id= oder aus SalesOrders List), wird sie verwendet
          if (firstOrderId) {
            const result = await testEndpoint(endpoint, { id: firstOrderId });
            testResults.push(result);
          } else {
            console.warn(`⚠️ "Get SalesOrder View" konnte nicht getestet werden, da keine ID verfügbar ist.`);
          }
        } else if (endpoint.name === "Delete Product" && deleteId) {
          const result = await testEndpoint(endpoint, { id: deleteId });
          testResults.push(result);
        } else if (endpoint.name === "Update Product" && updateId) {
          const result = await testEndpoint(endpoint, { id: updateId });
          testResults.push(result);
        } else if (!endpoint.requiresId) {
          const result = await testEndpoint(endpoint);
          testResults.push(result);
        } else {
          console.warn(`⚠️ Der Endpunkt "${endpoint.name}" benötigt eine ID, aber keine wurde angegeben.`);
        }
      }
    }

    console.log("\n✅ Alle Tests abgeschlossen.\n");

    // Slack nur ausführen, wenn DISABLE_SLACK nicht gesetzt ist
    if (!process.env.DISABLE_SLACK) {
      sendSlackReport(testResults);
    } else {
      console.log("\n🔕 Slack-Benachrichtigung ist deaktiviert (DISABLE_SLACK=true).\n");
    }

  } catch (error) {
    console.error("\n❌ Fehler beim Ausführen des Skripts:");
    console.error(`   ${error.message}\n`);
  }
}

// Benachrichtigungsfunktion für Slack
async function sendSlackReport(testResults) {
  try {
    let successCount = testResults.filter(r => r.success).length;
    const warnings = testResults.filter(r => !r.success && !r.isCritical && (r.missingFields.length > 0 || r.extraFields.length > 0));
    const criticals = testResults.filter(r => r.isCritical);

    const totalTests = testResults.length;
    const warningCount = warnings.length;
    const criticalCount = criticals.length;

    let message = `:mag: *API Testbericht ${new Date().toLocaleDateString()}*\n`;
    message += `---------------------------------------------\n`;

    if (warnings.length > 0 || criticals.length > 0) {
      message += `:pushpin: *Fehlerdetails:*\n`;
    } else {
      message += `✅ Alle Tests wurden erfolgreich ausgeführt. Keine Abweichungen gefunden!\n`;
    }

    let issueCounter = 1;
    let hasErrors = warnings.length > 0 || criticals.length > 0;

    [...warnings, ...criticals].forEach((issue) => {
      message += `\n`; // **Leerzeile vor jedem API-Fehlerbericht**

      const statusIcon = issue.isCritical ? ":red_circle:" : ":large_orange_circle:";
      message += `${issueCounter}️⃣ [${issue.method}] ${issue.endpointName} ${statusIcon}\n`;

      if (issue.missingFields.length > 0) {
        message += `:warning: *Fehlende Attribute:* ["${issue.missingFields.join('", "')}"]\n`;
      }

      if (issue.extraFields.length > 0) {
        message += `:warning: *Neue Attribute:* ["${issue.extraFields.join('", "')}"]\n`;
      }

      if (issue.isCritical && issue.errorMessage) {
        message += `:x: *Fehler:*\n -> ${issue.errorMessage}\n`;
      }

      issueCounter++;
    });

    if (hasErrors) {
      message += `\n`; // **Leerzeile nach den Fehlerdetails**
    }

    message += `---------------------------------------------\n`;
    message += `:bar_chart: *Gesamtstatistik:* ${totalTests} API-Calls\n`;
    message += `:small_blue_diamond: :large_green_circle: *Erfolgreich:* ${successCount}\n`;
    message += `:small_blue_diamond: :large_orange_circle: *Achtung:* ${warningCount}\n`;
    message += `:small_blue_diamond: :red_circle: *Kritisch:* ${criticalCount}\n`;
    message += `---------------------------------------------\n`;

    let statusIcon = criticalCount > 0 ? ":red_circle:" : warningCount > 0 ? ":large_orange_circle:" : ":large_green_circle:";
    message += `:loudspeaker: *Status:* ${statusIcon}\n`;

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
