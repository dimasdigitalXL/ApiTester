// versionChecker.js

const axios = require("axios");

/**
 * Prüft, ob für den übergebenen API-Endpunkt eine neue Version existiert (z. B. /v2/ statt /v1/).
 * Führt einen echten API-Call durch, um festzustellen, ob die neue Version gültig ist.
 * 
 * @param {Object} endpoint - Der API-Endpunkt aus der config.json
 * @param {Object} dynamicParams - Dynamische Platzhalter wie {id}, falls erforderlich
 * @returns {Object} endpoint (ggf. mit aktualisierter URL und versionChanged=true)
 */
async function checkAndUpdateApiVersion(endpoint, dynamicParams = {}) {
  // Extrahiere aktuelle Versionsnummer (z. B. /v1/)
  const versionRegex = /\/v(\d+)+\//;
  const match = endpoint.url.match(versionRegex);
  const currentVersion = match ? parseInt(match[1]) : null;

  // Wenn keine Version in der URL gefunden wurde, keine Prüfung
  if (!currentVersion) {
    return { ...endpoint, versionChanged: false };
  }

  // Berechne die zu testende neue Version (z. B. v2)
  let testedVersion = currentVersion + 1;

  // Ersetze in der URL die Versionsnummer
  const newUrl = endpoint.url.replace(`/v${currentVersion}/`, `/v${testedVersion}/`);

  // Ersetze Umgebungsvariablen und dynamische Parameter (z. B. ID)
  let finalUrl = newUrl.replace("${XENTRAL_ID}", process.env.XENTRAL_ID || "");
  for (const key in dynamicParams) {
    finalUrl = finalUrl.replace(`{${key}}`, dynamicParams[key]);
  }

  try {
    // Test-Call gegen neue URL durchführen
    const response = await axios.get(finalUrl, {
      headers: {
        Authorization: `Bearer ${process.env.BEARER_TOKEN}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "XentralAPITester"
      }
    });

    // Prüfen, ob keine typische Fehlerstruktur mit error.http_code === 0 zurückkommt
    if (
      response.status === 200 &&
      (!response.data?.error || response.data.error.http_code !== 0)
    ) {
      // Neue Version erfolgreich erkannt
      console.log(`✅ Neue API-Version erkannt: /v${testedVersion}/`);
      const updatedUrl = endpoint.url.replace(`/v${currentVersion}/`, `/v${testedVersion}/`);
      return {
        ...endpoint,
        url: updatedUrl,
        versionChanged: true
      };
    }

    // Antwortstatus zwar 200, aber API liefert Fehlerstruktur zurück
    console.warn(`⛔️ Version /v${testedVersion}/ liefert Fehlerstruktur – keine gültige API-Version.`);
  } catch (error) {
    // Request schlug fehl (z. B. 404, Timeout)
    console.warn(`⚠️ Fehler beim Prüfen von /v${testedVersion}/: ${error.message}`);
  }

  // Keine gültige Version gefunden → alles bleibt beim Alten
  return { ...endpoint, versionChanged: false };
}

module.exports = { checkAndUpdateApiVersion };