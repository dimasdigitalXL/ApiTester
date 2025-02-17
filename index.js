require("dotenv").config();
const fs = require("fs-extra");
const querystring = require("querystring");
const path = require("path");
const axios = require("axios");

// Funktion zum Vergleichen der Datenstruktur
function compareStructures(expected, actual, path = "") {
  const missingFields = [];
  const extraFields = [];
  const typeMismatches = [];

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
      missingFields.push(`Array ${path} ist leer, erwartet wurde mindestens ein Element.`);
    } else {
      for (let i = 0; i < expected.length; i++) {
        const result = compareStructures(expected[0], actual[i], `${path}[${i}]`);
        missingFields.push(...result.missingFields);
        extraFields.push(...result.extraFields);
        typeMismatches.push(...result.typeMismatches);
      }
    }
    return { missingFields, extraFields, typeMismatches };
  }

  // Überprüfen, ob Felder fehlen oder Typen nicht übereinstimmen
  for (const key in expected) {
    if (!Object.hasOwn(actual, key)) {
      missingFields.push(`${path ? path + "." : ""}${key}`);
    } else if (typeof actual[key] !== typeof expected[key]) {
      typeMismatches.push(
        `${path ? path + "." : ""}${key}: erwartet ${typeof expected[key]}, erhalten ${typeof actual[key]}`
      );
    } else if (typeof expected[key] === "object" && expected[key] !== null) {
      const result = compareStructures(expected[key], actual[key], `${path ? path + "." : ""}${key}`);
      missingFields.push(...result.missingFields);
      extraFields.push(...result.extraFields);
      typeMismatches.push(...result.typeMismatches);
    }
  }

  // Prüfen, ob es zusätzliche Felder in der API-Response gibt
  for (const key in actual) {
    if (!Object.hasOwn(expected, key)) {
      extraFields.push(`${path ? path + "." : ""}${key}`);
    }
  }

  return { missingFields, extraFields, typeMismatches };
}

// Funktion für API-Endpunkte
async function testEndpoint(endpoint, dynamicParams = {}) {
  try {
    console.log(`\n🔍 Starte Test für Endpunkt: ${endpoint.name}\n`);

    // Überprüfen, ob eine ID erforderlich ist, aber nicht übergeben wurde
    if (endpoint.requiresId && (!dynamicParams.id || dynamicParams.id.trim() === "")) {
      throw new Error(
        `Der Endpunkt "${endpoint.name}" benötigt eine ID, aber keine wurde angegeben.\n\n💡 *Hinweis*:\n -> Verwende node index.js "${endpoint.name}" --id=<SalesOrder-ID>`
      );
    }

    // URL vorbereiten und Platzhalter in der URL durch dynamische Parameter ersetzen
    let url = endpoint.url.replace("${XENTRAL_ID}", process.env.XENTRAL_ID);
    for (const param in dynamicParams) {
      url = url.replace(`{${param}}`, dynamicParams[param]);
    }

    // Erstellen der URL-Parameter (Query-String)
    const queryParams = new URLSearchParams(endpoint.query || {});

    // Request-Body aus Datei laden, falls vorhanden (nur für POST, PUT, PATCH)
    let body = null;
    if (["POST", "PUT", "PATCH"].includes(endpoint.method) && endpoint.bodyFile) {
      const bodyPath = path.join(__dirname, endpoint.bodyFile);
      if (fs.existsSync(bodyPath)) {
        const bodyContent = fs.readFileSync(bodyPath, "utf-8").trim();
        body = JSON.parse(bodyContent);
      } else {
        throw new Error(`❌ Fehler: Die Datei für den Request-Body existiert nicht: ${bodyPath}`);
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
      body: body ? JSON.stringify(body) : undefined
    });

    // Fehler ausgeben, falls der API-Request fehlschlägt
    if (!response.ok) {
      throw new Error(`HTTP-Fehler: ${response.status} ${response.statusText}`);
    }

    // API-Antwort 
    let responseData;
    const contentType = response.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      responseData = await response.json();
    } else {
      responseData = null; // Falls kein JSON, wird die Response nicht gespeichert
    }

    // Speichert die API-Response in einer Datei, falls vorhanden
    if (responseData) {
      const fileName = `${endpoint.name.replace(/\s+/g, "_")}_response.json`;
      const filePath = path.join(__dirname, "responses", fileName);
      fs.writeFileSync(filePath, JSON.stringify(responseData, null, 2));
    }

    // Erwartete Struktur aus Datei laden, falls vorhanden
    let expectedStructure = null;
    if (endpoint.expectedStructure) {
      expectedStructure = await fs.readJson(endpoint.expectedStructure);
    }

    // Falls eine erwartete Struktur existiert, wird sie mit der API-Response verglichen
    let warnings = [];
    if (expectedStructure && responseData) {
      const { missingFields, extraFields, typeMismatches } = compareStructures(expectedStructure, responseData);

      if (missingFields.length > 0) warnings.push(`⚠️ Fehlende Felder: ${missingFields.join(", ")}`);
      if (extraFields.length > 0) warnings.push(`⚠️ Neue Felder: ${extraFields.join(", ")}`);
      if (typeMismatches.length > 0) warnings.push(`⚠️ Typabweichungen: ${typeMismatches.join(", ")}`);
    }

    // Rückgabe des Testergebnisses
    return {
      endpointName: endpoint.name,
      method: endpoint.method,
      success: warnings.length === 0,
      isCritical: false,
      statusCode: response.status,
      errorMessage: response.ok ? null : `HTTP-Fehler: ${response.status} ${response.statusText}`,
      missingFields: warnings.includes("⚠️ Fehlende Felder") ? warnings : [],
      extraFields: warnings.includes("⚠️ Neue Felder") ? warnings : []
    };

  } catch (error) {
    console.error("\n❌ FEHLER:\n");
    console.error(`   ${error.message}\n`);
    logError(endpoint.name, error.message);

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

// Hauptfunktion
async function main() {
  try {
    console.log("\n📂 Lade Config-Datei...\n");
    const config = await fs.readJson("config.json");
    const endpoints = config.endpoints;

    const args = process.argv.slice(2);
    const selectedApi = args[0]?.startsWith("--") ? null : args[0]; // Prüft, ob ein API-Name übergeben wurde
    const dynamicParams = {};

    // Verarbeite Argumente wie --id=123
    args.forEach(arg => {
      const [key, value] = arg.split("=");
      if (key.startsWith("--")) {
        dynamicParams[key.replace("--", "")] = value;
      }
    });

    let testResults = []; // Hier speichern wir alle Testergebnisse
    let firstOrderId = dynamicParams.id || null; // Falls ID übergeben wurde, direkt nutzen

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
        } else {
          const result = await testEndpoint(endpoint);
          testResults.push(result);
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

/// Benachrichtigungsfunktion für Slack
async function sendSlackReport(testResults) {
  try {
    const successCount = testResults.filter(r => r.success).length;
    const warnings = testResults.filter(r => !r.success && !r.isCritical);
    const criticals = testResults.filter(r => r.isCritical);

    const totalTests = testResults.length;
    const warningCount = warnings.length;
    const criticalCount = criticals.length;

    let message = `:mag: *API Testbericht ${new Date().getDate()}/${new Date().getMonth() + 1}/${new Date().getFullYear()}*\n`;
    message += `---------------------------------------------\n`;
    message += `:pushpin: *Fehlerdetails:*\n`;

    let issueCounter = 1;

    [...warnings, ...criticals].forEach(issue => {
      const statusIcon = issue.isCritical ? ":red_circle:" : ":large_orange_circle:";
      message += `${issueCounter}️⃣ [${issue.method}] ${issue.endpointName} ${statusIcon}\n`;

      // Fehlende Attribute
      if (issue.missingFields.length > 0) {
        const missingFieldsShort = issue.missingFields.map(f => f.replace(/Feld fehlt: data\[0]\./, "").split(" ")[0]);
        message += `:warning: *Fehlende Attribute:* ["${missingFieldsShort.join('", "')}"]\n`;
      }

      // Neue Attribute
      if (issue.extraFields.length > 0) {
        const extraFieldsShort = issue.extraFields.map(f => f.replace(/Neues Feld gefunden: data\[0]\./, "").split(" ")[0]);
        message += `:warning: *Neue Attribute:* ["${extraFieldsShort.join('", "')}"]\n`;
      }

      if (issue.isCritical && issue.errorMessage) {
        message += `:x: *Fehler:*\n -> ${issue.errorMessage}\n`;
      }

      message += `\n`;
      issueCounter++;
    });

    // Gesamtstatistik
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
