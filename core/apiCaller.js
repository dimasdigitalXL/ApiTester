// apiCaller.js

const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
const {
  transformValues,
  getNextUpdatedPath,
  compareStructures
} = require("./structureAnalyzer");
const { resolveProjectPath } = require("./utils");

/**
 * Führt einen API-Test für einen bestimmten Endpoint durch.
 * Holt Daten, vergleicht sie mit der erwarteten Struktur und verwaltet Slack-Zustimmungen.
 */
async function testEndpoint(endpoint, dynamicParams = {}, config = null) {
  try {
    // 🔧 Ersetze Platzhalter in URL (z. B. ${XENTRAL_ID} oder {id})
    let url = endpoint.url.replace("${XENTRAL_ID}", process.env.XENTRAL_ID);
    for (const param in dynamicParams) {
      url = url.replace(`{${param}}`, dynamicParams[param]);
    }

    // 🧾 Optional: Query-Parameter vorbereiten
    const queryParams = new URLSearchParams(endpoint.query || {});
    let body = null;

    // 📦 Bei POST/PATCH/PUT: Lade JSON-Body aus Datei
    if (["POST", "PUT", "PATCH"].includes(endpoint.method)) {
      if (endpoint.bodyFile) {
        const bodyPath = resolveProjectPath(endpoint.bodyFile);
        if (fs.existsSync(bodyPath)) {
          body = fs.readJsonSync(bodyPath);
        }
      }
    }

    // 📡 Führe API-Request aus
    const response = await axios({
      url: `${url}?${queryParams.toString()}`,
      method: endpoint.method,
      data: body,
      headers: {
        Authorization: `Bearer ${process.env.BEARER_TOKEN}`,
        Accept: endpoint.headers?.Accept || "application/json",
        ...(endpoint.method !== "GET" && { "Content-Type": "application/json" })
      },
      validateStatus: () => true
    });

    // 🧼 Fallback: Leere JSON bei ungültiger Antwort
    let responseData = {};
    try {
      responseData = response.data;
    } catch {
      console.warn("Antwort ist kein gültiges JSON.");
    }

    // 💡 Falls kein expectedStructure gesetzt → Test als erfolgreich markieren
    if (!endpoint.expectedStructure) {
      console.log(`ℹ️ Kein expectedStructure für "${endpoint.name}" definiert – Test wird übersprungen.`);
      return {
        endpointName: endpoint.name,
        method: endpoint.method,
        success: true,
        isCritical: false,
        statusCode: response.status,
        errorMessage: null,
        missingFields: [],
        extraFields: [],
        typeMismatches: [],
        updatedStructure: null
      };
    }

    // 🔄 Lade erwartete Struktur aus config.json
    const expectedPath = resolveProjectPath(endpoint.expectedStructure);
    const approvalsPath = resolveProjectPath("pending-approvals.json");
    const baseName = endpoint.name.replace(/\s+/g, "_");

    console.log("📁 baseName:", baseName);
    console.log("📁 expectedPath (laut config.json):", expectedPath);

    if (!fs.existsSync(expectedPath)) {
      console.warn("⚠️ Datei nicht vorhanden:", expectedPath);
    }

    let expectedStructure = {};
    if (fs.existsSync(expectedPath)) {
      expectedStructure = await fs.readJson(expectedPath);
    }

    // 🔍 Vergleiche Response mit erwarteter Struktur
    const transformed = transformValues(responseData);
    const { missingFields, extraFields, typeMismatches } = compareStructures(expectedStructure, transformed);
    const hasDifferences =
      missingFields.length > 0 || extraFields.length > 0 || typeMismatches.length > 0;

    // 💾 Wenn Unterschiede gefunden wurden: Neue Struktur speichern
    let updatedPath = null;
    if (hasDifferences) {
      updatedPath = getNextUpdatedPath(baseName);
      await fs.writeJson(updatedPath, transformed, { spaces: 2 });
      console.log(`📄 Struktur aktualisiert und gespeichert: ${updatedPath}`);

      // ✅ Prüfe, ob Slack-Zustimmung existiert (pending-approvals.json)
      if (fs.existsSync(approvalsPath)) {
        const approvals = await fs.readJson(approvalsPath);
        const approvalStatus = approvals[baseName];
        console.log("🔎 Slack-Zustimmung für", baseName, ":", approvalStatus);

        if (approvalStatus === "approved") {
          if (config) {
            const found = config.endpoints.find(e => e.name === endpoint.name);
            if (found) {
              // 📌 Aktualisiere expectedStructure in config.json
              found.expectedStructure = path
                .relative(resolveProjectPath(), updatedPath)
                .replace(/\\/g, "/");
              console.log("🔁 Ersetze expectedStructure:", found.expectedStructure);

              await fs.writeJson(resolveProjectPath("config.json"), config, { spaces: 2 });
              console.log(`🛠️ config.json aktualisiert → ${found.expectedStructure}`);

              // 🧹 Zustimmung wieder zurück auf "waiting"
              approvals[baseName] = "waiting";
              await fs.writeJson(approvalsPath, approvals, { spaces: 2 });
            }
          }
        }
      }
    }

    // 📤 Rückgabe des Testergebnisses
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
      updatedStructure: hasDifferences ? path.basename(updatedPath) : null
    };
  } catch (error) {
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