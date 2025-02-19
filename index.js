require("dotenv").config();
const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");

// Funktion zum Vergleichen der Datenstruktur
function compareStructures(expected, actual, path = "") {
  const missingFields = [];
  const extraFields = [];
  const typeMismatches = [];

  if (Array.isArray(expected) !== Array.isArray(actual)) {
    typeMismatches.push(
      `Typen stimmen nicht überein bei ${path || "root"}: erwartet ${
        Array.isArray(expected) ? "Array" : "Object"
      }, erhalten ${Array.isArray(actual) ? "Array" : "Object"}`
    );
    return { missingFields, extraFields, typeMismatches };
  }

  if (Array.isArray(expected)) {
    if (actual.length === 0) {
      console.log(`🔹 Array ${path} ist leer, wird aber nicht als Fehler gewertet.`);
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

  for (const key in expected) {
    if (!Object.hasOwn(actual, key)) {
      missingFields.push(`${path ? path + "." : ""}${key}`);
    } else if (typeof actual[key] !== typeof expected[key]) {
      typeMismatches.push(`${path ? path + "." : ""}${key}: erwartet ${typeof expected[key]}, erhalten ${typeof actual[key]}`);
    } else if (typeof expected[key] === "object" && expected[key] !== null) {
      const result = compareStructures(expected[key], actual[key], `${path ? path + "." : ""}${key}`);
      missingFields.push(...result.missingFields);
      extraFields.push(...result.extraFields);
      typeMismatches.push(...result.typeMismatches);
    }
  }

  for (const key in actual) {
    if (!Object.hasOwn(expected, key)) {
      extraFields.push(`${path ? path + "." : ""}${key}`);
    }
  }

  return {
    missingFields: missingFields.map(f => f.replace(/^data\[0]\./, "")), 
    extraFields: extraFields.map(f => f.replace(/^data\[0]\./, "")), 
    typeMismatches
  };
}

// Funktion für API-Endpunkte
async function testEndpoint(endpoint, dynamicParams = {}) {
  try {
    console.log(`\n🔍 Starte Test für Endpunkt: ${endpoint.name}\n`);

    if (endpoint.requiresId && (!dynamicParams.id || dynamicParams.id.trim() === "")) {
      throw new Error(`Der Endpunkt "${endpoint.name}" benötigt eine ID, aber keine wurde angegeben.`);
    }

    let url = endpoint.url.replace("${XENTRAL_ID}", process.env.XENTRAL_ID);
    for (const param in dynamicParams) {
      url = url.replace(`{${param}}`, dynamicParams[param]);
    }

    const queryParams = new URLSearchParams(endpoint.query || {});
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

    const response = await fetch(`${url}?${queryParams.toString()}`, {
      method: endpoint.method,
      headers: {
        ...endpoint.headers,
        Authorization: `Bearer ${process.env.BEARER_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: body ? JSON.stringify(body) : undefined
    });

    if (!response.ok) {
      throw new Error(`HTTP-Fehler: ${response.status} ${response.statusText}`);
    }

    let responseData = null;
    const contentType = response.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      responseData = await response.json();
    }

    if (!responseData) {
      console.warn(`⚠️ Keine API-Response zum Speichern für ${endpoint.name}.`);
      responseData = {};
    }

    if (["POST", "PUT", "PATCH"].includes(endpoint.method)) {
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

    let expectedStructure = null;
    if (endpoint.expectedStructure && fs.existsSync(endpoint.expectedStructure)) {
      expectedStructure = await fs.readJson(endpoint.expectedStructure);
    }

    if (!expectedStructure) {
      console.warn(`⚠️ Erwartete Vergleichsstruktur für ${endpoint.name} nicht vorhanden.`);
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

    const { missingFields, extraFields } = compareStructures(expectedStructure, responseData);

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
    console.error("\n❌ FEHLER:\n", error.message);
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
