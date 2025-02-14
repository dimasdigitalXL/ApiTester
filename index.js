require("dotenv").config();
const fs = require("fs-extra");
const querystring = require("querystring");
const path = require("path");
const axios = require("axios");

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
    let url = endpoint.url;
    for (const param in dynamicParams) {
      url = url.replace(`{${param}}`, dynamicParams[param]);
    }

    // Erstellen der URL-Parameter (Query-String)
    const queryParams = new URLSearchParams(endpoint.query || {});

    // API-Request durchführen
    const response = await fetch(`${url}?${queryParams.toString()}`, {
      method: endpoint.method, // HTTP-Methode (GET, POST, PUT, DELETE etc.)
      headers: {
        ...endpoint.headers, // Zusätzliche Header aus der Konfiguration übernehmen
        Authorization: `Bearer ${process.env.BEARER_TOKEN}`, // Authentifizierung mit Bearer-Token
      },
    });

    // Fehler ausgeben, falls der API-Request fehlschlägt
    if (!response.ok) {
      throw new Error(`HTTP-Fehler: ${response.status} ${response.statusText}`);
    }

    // Antwort der API in JSON umwandeln
    const responseData = await response.json();

    // Speichert die API-Response in einer Datei für spätere Analyse
    const fileName = `${endpoint.name.replace(/\s+/g, "_")}_response.json`;
    const filePath = path.join(__dirname, "responses", fileName);
    fs.writeFileSync(filePath, JSON.stringify(responseData, null, 2));

    console.log(`✅ Response für ${endpoint.name} gespeichert unter:`);
    console.log(`   📁 ${filePath}\n`);

    // Erwartete Struktur aus Datei laden
    const expectedStructure = await fs.readJson(endpoint.expectedStructure);

    // Vergleich der API-Antwort mit der erwarteten Struktur
    const { missingFields, extraFields, typeMismatches } = compareStructures(expectedStructure, responseData);

    // Initialisierung der Warnungs- und Fehlerlisten
    let warnings = [];
    let criticalErrors = [];

    // Prüft, ob erwartete Felder fehlen
    if (missingFields.length > 0) {
      warnings.push(`⚠️ Fehlende Felder: ${missingFields.join(", ")}`);
    }

    // Prüft, ob neue (unerwartete) Felder in der API-Response enthalten sind
    if (extraFields.length > 0) {
      warnings.push(`⚠️ Neue Felder: ${extraFields.join(", ")}`);
    }

    // Prüft, ob es Typabweichungen gibt
    if (typeMismatches.length > 0) {
      warnings.push(`⚠️ Typabweichungen: ${typeMismatches.join(", ")}`);
    }

    // Ausgabe der Ergebnisse in der Konsole
    if (warnings.length === 0) {
      console.log(`✅ ${endpoint.name}: Struktur ist korrekt.\n`);
    } else {
      console.warn("\n🟠 ACHTUNG:");
      warnings.forEach(msg => console.warn(`   ${msg}`));
    }

    // Rückgabe des Testergebnisses zur späteren Verarbeitung (z. B. für den Slack-Report)
    return {
      endpointName: endpoint.name,
      method: endpoint.method,
      success: warnings.length === 0, // Erfolgreich, wenn keine Warnungen vorhanden sind
      isCritical: false, // Diese API-Tests sind standardmäßig nicht kritisch
      statusCode: response.status, // HTTP-Statuscode des Requests
      errorMessage: response.ok ? null : `HTTP-Fehler: ${response.status} ${response.statusText}`, // Falls vorhanden, die Fehlermeldung
      missingFields,
      extraFields,
    };

  } catch (error) {
    console.error("\n❌ FEHLER:\n");
    console.error(`   ${error.message}\n`);
    logError(endpoint.name, error.message);

    // Falls ein kritischer Fehler auftritt, wird das als kritisches Problem markiert
    return {
      endpointName: endpoint.name,
      method: endpoint.method,
      success: false, // Fehlgeschlagen
      isCritical: true, // Kritischer Fehler
      statusCode: null, // Kein HTTP-Statuscode verfügbar
      errorMessage: error.message, // Fehlermeldung speichern
      missingFields: [],
      extraFields: [],
    };
  }
}

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
      missingFields.push(`Feld fehlt: ${path ? path + "." : ""}${key} (Erwartet, aber nicht gefunden)`);
    } else if (
      typeof actual[key] !== typeof expected[key] &&
      !(typeof expected[key] === "string" && (actual[key] === null || typeof actual[key] === "object"))
    ) {
      typeMismatches.push(
        `Falscher Typ für Feld ${path ? path + "." : ""}${key}: erwartet ${typeof expected[key]}, erhalten ${typeof actual[key]}`
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
      extraFields.push(`Neues Feld gefunden: ${path ? path + "." : ""}${key} (Nicht erwartet, aber erhalten)`);
    }
  }

  return { missingFields, extraFields, typeMismatches };
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

    // Hier wird nach Abschluss der Tests das Slack-Reporting aufgerufen
    sendSlackReport(testResults);

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
    const successfulTests = testResults.filter(r => r.success); // Erfolgreiche Tests filtern

    const totalTests = testResults.length;
    const warningCount = warnings.length;
    const criticalCount = criticals.length;

    let message = `:mag: *API Testbericht ${new Date().getDate()}/${new Date().getMonth() + 1}/${new Date().getFullYear()}*\n`;
    message += `---------------------------------------------\n`;
    message += `:pushpin: *Fehlerdetails:*\n`;

    let issueCounter = 1;

    [...warnings, ...criticals].forEach(issue => {
      const statusIcon = issue.isCritical ? ":red_circle:" : ":large_orange_circle:";
      message += `${issueCounter}️⃣ [${issue.method}] ${issue.endpointName} ${statusIcon}\n\n`;

      if (issue.missingFields.length > 0) {
        message += `:warning: *Fehlende Felder:*\n`;
        issue.missingFields.forEach(field => {
          message += `-> ${field}\n`;
        });
        message += `\n`;
      }

      if (issue.extraFields.length > 0) {
        message += `:warning: *Neue Felder:*\n`;
        issue.extraFields.forEach(field => {
          message += `-> ${field}\n`;
        });
        message += `\n`;
      }

      if (issue.isCritical && issue.errorMessage) {
        message += `:x: *Fehler:*\n`;
        message += `-> ${issue.errorMessage}\n\n`;
      }

      issueCounter++;
    });

    // Fehlerfreie Sektion hinzufügen
    if (successfulTests.length > 0) {
      message += `---------------------------------------------\n`;
      message += `:white_check_mark: *Fehlerfrei:*\n`;
      let successCounter = 1;
      successfulTests.forEach(s => {
        message += `${successCounter}️⃣ [${s.method}] ${s.endpointName} :large_green_circle:\n\n`;
        successCounter++;
      });
    }

    //Gesamtstatistik
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
