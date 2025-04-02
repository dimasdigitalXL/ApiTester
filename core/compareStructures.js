// compareStructures.js

/**
 * Vergleicht zwei verschachtelte JSON-Strukturen (expected vs. actual).
 * Gibt Listen mit Abweichungen zurück:
 * - missingFields: Felder, die im actual fehlen
 * - extraFields: Felder, die im actual vorkommen, aber nicht im expected
 * - typeMismatches: Felder, die in beiden vorkommen, aber unterschiedlichen Typ haben
 * 
 * @param {Object} expected - Erwartete Struktur (z. B. aus expected/*.json)
 * @param {Object} actual - Tatsächlich zurückgegebene API-Response (transformiert)
 * @param {String} path - Interner Pfad für verschachtelte Felder (rekursiv genutzt)
 */
function compareStructures(expected, actual, path = "") {
  const missingFields = [];
  const extraFields = [];
  const typeMismatches = [];

  // Sonderfall: Arrays → vergleiche nur erstes Element
  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length > 0 && actual.length > 0) {
      return compareStructures(expected[0], actual[0], path);
    }
    return { missingFields, extraFields, typeMismatches };
  }

  // Wenn kein Objekt → Vergleich nicht sinnvoll
  if (typeof expected !== "object" || typeof actual !== "object" || !expected || !actual) {
    return { missingFields, extraFields, typeMismatches };
  }

  // 1. Fehlende Felder und Typabweichungen prüfen
  for (const key in expected) {
    const currentPath = `${path ? path + "." : ""}${key}`;
    if (!(key in actual)) {
      missingFields.push(currentPath); // Feld fehlt komplett
    } else if (
      typeof expected[key] === "object" &&
      expected[key] !== null &&
      typeof actual[key] === "object" &&
      actual[key] !== null
    ) {
      // Rekursiver Vergleich bei verschachtelten Objekten
      const subResult = compareStructures(expected[key], actual[key], currentPath);
      missingFields.push(...subResult.missingFields);
      extraFields.push(...subResult.extraFields);
      typeMismatches.push(...subResult.typeMismatches);
    } else if (typeof expected[key] !== typeof actual[key]) {
      // Typabweichung bei gleichem Key
      typeMismatches.push({
        path: currentPath,
        expected: typeof expected[key],
        actual: typeof actual[key]
      });
    }
  }

  // 2. Zusätzliche Felder erkennen
  for (const key in actual) {
    if (!(key in expected)) {
      const currentPath = `${path ? path + "." : ""}${key}`;
      extraFields.push(currentPath);
    }
  }

  return { missingFields, extraFields, typeMismatches };
}

module.exports = compareStructures;
