// apiCaller.js

// Externe Module
const fs = require("fs-extra"); // Erweiterte File-System-Funktionen
const path = require("path"); // Pfad-Handling
const axios = require("axios"); // Für HTTP-Requests
const compareStructures = require("./compareStructures"); // Strukturanalyse & Vergleichsfunktion

/**
 * transformValues:
 * Normalisiert Werte in der API-Response für die erwartete Strukturdatei:
 * - Strings → "string"
 * - Zahlen → 0
 * - Arrays und Objekte → rekursiv durchlaufen
 * - Andere Werte (null, boolean etc.) bleiben wie sie sind
 */
function transformValues(value) {
  if (typeof value === "string") return "string";
  if (typeof value === "number") return 0;
  if (Array.isArray(value)) return value.map(transformValues);
  if (value && typeof value === "object") {
    const result = {};
    for (const key in value) {
      result[key] = transformValues(value[key]);
    }
    return result;
  }
  return value;
}

/**
 * getLatestUpdatedPath:
 * Ermittelt den Pfad zur aktuellsten `*_updated.json` oder `*_updated_vX.json`-Datei
 * für eine bestimmte API (z. B. "Get_View_Product")
 */
function getLatestUpdatedPath(baseName) {
  const dir = path.join(__dirname, "..", "expected");
  const files = fs.readdirSync(dir);
  const basePattern = new RegExp(`^${baseName}_updated(?:_v(\\d+))?\\.json$`);

  const matching = files
    .map(f => ({ file: f, match: f.match(basePattern) }))
    .filter(f => f.match)
    .sort((a, b) => {
      const aVer = a.match[1] ? parseInt(a.match[1]) : 0;
      const bVer = b.match[1] ? parseInt(b.match[1]) : 0;
      return bVer - aVer;
    });

  return matching.length > 0
    ? path.join(dir, matching[0].file)
    : path.join(dir, `${baseName}_updated.json`);
}

/**
 * getNextUpdatedPath:
 * Erzeugt den Pfad für die nächste Version der updated-Struktur,
 * z. B. `_updated_v2.json` oder `_updated_v3.json`
 */
function getNextUpdatedPath(baseName) {
  const dir = path.join(__dirname, "..", "expected");
  const files = fs.readdirSync(dir);
  const basePattern = new RegExp(`^${baseName}_updated(?:_v(\\d+))?\\.json$`);

  const versions = files
    .map(f => {
      const match = f.match(basePattern);
      return match ? (match[1] ? parseInt(match[1]) : 0) : null;
    })
    .filter(v => v !== null);

  const nextVer = versions.length > 0 ? Math.max(...versions) + 1 : 0;

  return path.join(
    dir,
    `${baseName}_updated${nextVer === 0 ? "" : `_v${nextVer}`}.json`
  );
}

/**
 * testEndpoint:
 * Hauptfunktion zur Durchführung eines einzelnen API-Tests
 * - API-Call ausführen
 * - Antwort transformieren (normalize)
 * - Mit vorhandener erwarteter Struktur vergleichen
 * - Abweichungen (fehlende/zusätzliche Felder, Typabweichungen) erkennen
 * - Neue Struktur als `*_updated[_vX].json` speichern
 * - config.json aktualisieren, falls nötig
 */
async function testEndpoint(endpoint, dynamicParams = {}, config = null) {
  try {
    // 🔁 URL zusammenbauen (XENTRAL_ID + evtl. {id})
    let url = endpoint.url.replace("${XENTRAL_ID}", process.env.XENTRAL_ID);
    for (const param in dynamicParams) {
      url = url.replace(`{${param}}`, dynamicParams[param]);
    }

    // 🔧 Query-Parameter + Body laden (falls POST/PATCH/PUT)
    const queryParams = new URLSearchParams(endpoint.query || {});
    let body = null;

    if (["POST", "PUT", "PATCH"].includes(endpoint.method)) {
      if (endpoint.bodyFile) {
        const bodyPath = path.join(__dirname, "..", endpoint.bodyFile);
        if (fs.existsSync(bodyPath)) {
          body = fs.readJsonSync(bodyPath);
        }
      }
    }

    // 🛰️ API-Request
    const response = await axios({
      url: `${url}?${queryParams.toString()}`,
      method: endpoint.method,
      data: body,
      headers: {
        Authorization: `Bearer ${process.env.BEARER_TOKEN}`,
        Accept: endpoint.headers?.Accept || "application/json",
        ...(endpoint.method !== "GET" && { "Content-Type": "application/json" })
      },
      validateStatus: () => true // → auch 400/500 Responses erlauben
    });

    // 🧪 Datenstruktur auswerten
    let responseData = {};
    try {
      responseData = response.data;
    } catch {
      console.warn("Antwort ist kein gültiges JSON.");
    }

    const transformed = transformValues(responseData);
    const baseName = endpoint.name.replace(/\s+/g, "_");
    const latestExpectedPath = getLatestUpdatedPath(baseName);

    let expectedStructure = {};
    if (fs.existsSync(latestExpectedPath)) {
      expectedStructure = await fs.readJson(latestExpectedPath);
    } else if (endpoint.expectedStructure) {
      const fallbackPath = path.resolve(endpoint.expectedStructure);
      if (fs.existsSync(fallbackPath)) {
        expectedStructure = await fs.readJson(fallbackPath);
      }
    }

    // 🔍 Vergleich der Strukturen
    const { missingFields, extraFields, typeMismatches } = compareStructures(expectedStructure, transformed);
    const hasDifferences =
      missingFields.length > 0 || extraFields.length > 0 || typeMismatches.length > 0;

    // 💾 Wenn Unterschiede: neue Struktur speichern & config aktualisieren
    if (hasDifferences) {
      const newPath = getNextUpdatedPath(baseName);
      await fs.writeJson(newPath, transformed, { spaces: 2 });
      console.log(`📄 Struktur aktualisiert und gespeichert: ${newPath}`);

      if (config) {
        const found = config.endpoints.find(e => e.name === endpoint.name);
        if (found) {
          found.expectedStructure = path.relative(path.join(__dirname, ".."), newPath).replace(/\\/g, "/");
          await fs.writeJson(path.join(__dirname, "..", "config.json"), config, { spaces: 2 });
          console.log(`🛠️ config.json aktualisiert → ${found.expectedStructure}`);
        }
      }
    }

    return {
      endpointName: endpoint.name,
      method: endpoint.method,
      success: !hasDifferences,
      isCritical: false,
      statusCode: response.status,
      errorMessage: null,
      missingFields,
      extraFields,
      typeMismatches,
      updatedStructure: hasDifferences ? path.basename(getNextUpdatedPath(baseName)) : null
    };
  } catch (error) {
    // ❌ Bei Request-Fehlern: Ergebnis als "kritisch" markieren
    console.error(`Fehler bei ${endpoint.name}: ${error.message}`);
    return {
      endpointName: endpoint.name,
      method: endpoint.method,
      success: false,
      isCritical: true,
      statusCode: null,
      errorMessage: error.message,
      missingFields: [],
      extraFields: [],
      typeMismatches: []
    };
  }
}

module.exports = { testEndpoint };