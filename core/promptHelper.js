// promptHelper.js

const readline = require("readline");

/**
 * Fordert den Benutzer im Terminal auf, manuell eine ID einzugeben.
 * Wird z. B. verwendet, wenn kein gespeicherter Default-Wert in default-ids.json existiert.
 *
 * @param {string} message - Die Nachricht, die dem Benutzer angezeigt wird (z. B. "Bitte ID angeben:")
 * @returns {Promise<string>} - Die vom Benutzer eingegebene ID (als String, ohne Leerzeichen)
 */
function promptUserForId(message) {
  return new Promise((resolve) => {
    // Initialisiert ein readline-Interface für Eingabe über die Kommandozeile
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    // Stellt dem Benutzer die Frage, wartet auf Eingabe und gibt diese dann zurück
    rl.question(message, (answer) => {
      rl.close();
      resolve(answer.trim()); // Entfernt ggf. Leerzeichen vor/nach der Eingabe
    });
  });
}

module.exports = { promptUserForId };
