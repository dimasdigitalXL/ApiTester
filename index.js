require("dotenv").config();
const fs = require("fs-extra");
const querystring = require("querystring");
const path = require("path");

async function testEndpoint(endpoint, dynamicParams = {}) {
  try {
    console.log(`\n🔍 Starte Test für Endpunkt: ${endpoint.name}\n`);

    // Überprüfen, ob die ID erforderlich ist, aber nicht übergeben wurde
    if (endpoint.requiresId && (!dynamicParams.id || dynamicParams.id.trim() === "")) {
      throw new Error(`❌ Fehler: Der Endpunkt "${endpoint.name}" benötigt eine ID, aber keine wurde angegeben.\n\n💡 Verwende: node index.js "${endpoint.name}" --id=<SalesOrder-ID>\n`);
    }

    // Ersetze Platzhalter in der URL (z. B. {id})
    let url = endpoint.url;
    for (const param in dynamicParams) {
      url = url.replace(`{${param}}`, dynamicParams[param]);
    }

    const queryParams = new URLSearchParams(endpoint.query || {});
    const response = await fetch(`${url}?${queryParams.toString()}`, {
      method: endpoint.method,
      headers: {
        ...endpoint.headers,
        "Authorization": `Bearer ${process.env.BEARER_TOKEN}`
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP-Fehler: ${response.status} ${response.statusText}`);
    }

    const responseData = await response.json();

    // Speichere die Response in einer Datei
    const fileName = `${endpoint.name.replace(/\s+/g, "_")}_response.json`;
    const filePath = path.join(__dirname, "responses", fileName);
    fs.writeFileSync(filePath, JSON.stringify(responseData, null, 2));

    console.log(`✅ Response für ${endpoint.name} gespeichert unter:`);
    console.log(`   📁 ${filePath}\n`);

    const expectedStructure = await fs.readJson(endpoint.expectedStructure);
    const { missingFields, extraFields, typeMismatches } = compareStructures(expectedStructure, responseData);

    if (missingFields.length > 0) {
      console.warn("\n⚠️ WARNUNG: Erwartete Felder fehlen:");
      missingFields.forEach(field => console.warn(`   ❌ ${field}`));
    }
    
    if (extraFields.length > 0) {
      console.error("\n🚨 FEHLER: Unerwartete Felder gefunden:");
      extraFields.forEach(field => console.error(`   🛑 ${field}`));
    }
    
    if (typeMismatches.length > 0) {
      console.warn("\n⚠️ WARNUNG: Typabweichungen:");
      typeMismatches.forEach(typeIssue => console.warn(`   ⚡ ${typeIssue}`));
    }
    
    if (missingFields.length === 0 && extraFields.length === 0 && typeMismatches.length === 0) {
      console.log(`✅ ${endpoint.name}: Struktur ist korrekt.\n`);
    }
     else {
      console.log(`✅ ${endpoint.name}: Struktur ist korrekt.\n`);
    }

    return responseData; // Gibt die Antwort zurück (nützlich für Sales Order View)
  } catch (error) {
    console.error("\n❌ FEHLER:\n");
    console.error(`   ${error.message}\n`);
    logError(endpoint.name, error.message);
    return null;
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

    // CLI-Argumente verarbeiten
    const args = process.argv.slice(2);
    const selectedApi = args[0]; // Erstes Argument ist der API-Name
    const dynamicParams = {};

    // Suche nach weiteren Parametern wie --id=285
    args.slice(1).forEach(arg => {
      const [key, value] = arg.split("=");
      if (key.startsWith("--")) {
        dynamicParams[key.replace("--", "")] = value;
      }
    });

    if (selectedApi) {
      console.log(`🚀 Starte gezielten API-Test für: ${selectedApi}\n`);
      const endpoint = endpoints.find(ep => ep.name === selectedApi);

      if (endpoint) {
        await testEndpoint(endpoint, dynamicParams);
      } else {
        console.error(`❌ Fehler: Kein API-Call mit dem Namen "${selectedApi}" gefunden.\n`);
      }
    } else {
      console.log(`🚀 Starte alle API-Tests um ${new Date().toISOString()}\n`);

      let firstOrderId = null;
      for (const endpoint of endpoints) {
        if (endpoint.name === "Get SalesOrders List") {
          const responseData = await testEndpoint(endpoint);
          if (responseData?.data?.length > 0) {
            firstOrderId = responseData.data[0].id;
            console.log(`🔗 Gefundene SalesOrder ID für Detailansicht: ${firstOrderId}\n`);
          }
        } else if (endpoint.name === "Get SalesOrder View" && firstOrderId) {
          await testEndpoint(endpoint, { id: firstOrderId });
        } else {
          await testEndpoint(endpoint);
        }
      }
    }

    console.log("\n✅ Alle Tests abgeschlossen.\n");
  } catch (error) {
    console.error("\n❌ Fehler beim Ausführen des Skripts:");
    console.error(`   ${error.message}\n`);
  }
}

// Direktes Ausführen, wenn das Skript gestartet wird
if (require.main === module) {
  main();
}

