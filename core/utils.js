/**
 * Ersetzt sicher ein Muster in einem String, wenn der Eingabewert gültig ist.
 * Gibt eine Warnung aus, wenn der Eingabewert nicht vorhanden oder kein String ist.
 * 
 * @param {string} value - Der ursprüngliche String, in dem ersetzt werden soll
 * @param {string|RegExp} search - Das zu ersetzende Muster (String oder RegExp)
 * @param {string} replace - Der Ersatzstring
 * @returns {string} - Der resultierende String nach dem Ersetzen oder unverändert
 */
function safeReplace(value, search, replace) {
  if (value && typeof value === "string") {
    return value.replace(search, replace);
  }
  console.warn(`Warnung: Der Wert zum Ersetzen ist nicht verfügbar oder ungültig: ${value}`);
  return value;
}

/**
 * Ähnlich wie `safeReplace`, aber mit zusätzlichem Fallback:
 * Wenn der ursprüngliche Wert nicht gesetzt ist, wird ein leerer String zurückgegeben.
 * 
 * @param {string} value - Der ursprüngliche String
 * @param {string} placeholder - Der Platzhalter, der ersetzt werden soll
 * @param {string} replacement - Der Ersatzstring
 * @returns {string} - Ersetzter String oder leerer Fallback
 */
function replaceWithFallback(value, placeholder, replacement) {
  if (value && typeof value === "string") {
    return value.replace(placeholder, replacement);
  }
  console.warn(`Warnung: Ersetzen von undefined oder ungültigem Wert bei: ${value}`);
  return value || "";
}

module.exports = {
  safeReplace,
  replaceWithFallback
};