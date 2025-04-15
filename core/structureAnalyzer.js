// core/structureAnalyzer.js

const fs = require("fs-extra");
const path = require("path");
const compareStructures = require("./compareStructures");
const { resolveProjectPath } = require("./utils");

/**
 * Konvertiert verschachtelte API-Antwort in abstraktes Typmodell
 * (Strings → "string", Zahlen → 0 usw.)
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
  return value; // z. B. null, boolean etc.
}

/**
 * Gibt exakt den Pfad zurück, der in der config.json als expectedStructure definiert ist.
 * → Dieser Pfad soll als Referenz für die Vergleichsstruktur verwendet werden.
 */
function getLatestUpdatedPath(baseName, endpoint) {
  if (endpoint.expectedStructure) {
    return resolveProjectPath(endpoint.expectedStructure);
  }
  return null;
}

/**
 * Gibt den nächsten freien Pfad für eine neue aktualisierte Struktur zurück
 * → z. B. "Get_List_Customers_updated_v3.json"
 */
function getNextUpdatedPath(baseName) {
  const dir = resolveProjectPath("expected");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);

  const files = fs.readdirSync(dir);
  const basePattern = new RegExp(`^${baseName}_updated(?:_v(\\d+))?\\.json$`);

  const versions = files
    .map(f => {
      const match = f.match(basePattern);
      return match ? (match[1] ? parseInt(match[1]) : 0) : null;
    })
    .filter(v => v !== null);

  const nextVer = versions.length > 0 ? Math.max(...versions) + 1 : 0;

  return resolveProjectPath(
    "expected",
    `${baseName}_updated${nextVer === 0 ? "" : `_v${nextVer}`}.json`
  );
}

/**
 * Gibt die zuletzt generierte *_updated[_vX].json Datei für einen Endpunkt zurück
 * → z. B. "Get_View_Customer_updated_v3.json"
 * (Nur der Dateiname, nicht der vollständige Pfad)
 */
function getLatestUpdatedFile(baseName) {
  const dir = resolveProjectPath("expected");
  if (!fs.existsSync(dir)) return null;

  const files = fs.readdirSync(dir);
  const regex = new RegExp(`^${baseName}_updated(?:_v(\\d+))?\\.json$`);

  const matching = files
    .map(f => ({ file: f, match: f.match(regex) }))
    .filter(f => f.match)
    .sort((a, b) => parseInt(b.match[1] || 0) - parseInt(a.match[1] || 0));

  return matching.length > 0 ? matching[0].file : null;
}

module.exports = {
  transformValues,
  getLatestUpdatedPath,
  getNextUpdatedPath,
  getLatestUpdatedFile,
  compareStructures
};