// utils.js

function safeReplace(value, search, replace) {
    if (value && typeof value === "string") {
      return value.replace(search, replace);
    }
    console.warn(`Warnung: Der Wert zum Ersetzen ist nicht verfügbar oder ungültig: ${value}`);
    return value;
  }
  
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
  