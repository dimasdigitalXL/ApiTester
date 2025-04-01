// versionChecker.js

const axios = require("axios");

async function checkAndUpdateApiVersion(endpoint, dynamicParams = {}) {
  const versionRegex = /\/v(\d+)+\//;
  const match = endpoint.url.match(versionRegex);
  const currentVersion = match ? parseInt(match[1]) : null;

  if (!currentVersion) {
    return { ...endpoint, versionChanged: false };
  }

  let testedVersion = currentVersion + 1;
  const newUrl = endpoint.url.replace(`/v${currentVersion}/`, `/v${testedVersion}/`);

  let finalUrl = newUrl.replace("${XENTRAL_ID}", process.env.XENTRAL_ID || "");
  for (const key in dynamicParams) {
    finalUrl = finalUrl.replace(`{${key}}`, dynamicParams[key]);
  }

  try {
    const response = await axios.get(finalUrl, {
      headers: {
        Authorization: `Bearer ${process.env.BEARER_TOKEN}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "XentralAPITester"
      }
    });

    // nur akzeptieren, wenn kein error-Feld enthalten ist
    if (
      response.status === 200 &&
      (!response.data?.error || response.data.error.http_code !== 0)
    ) {
      console.log(`✅ Neue API-Version erkannt: /v${testedVersion}/`);
      const updatedUrl = endpoint.url.replace(`/v${currentVersion}/`, `/v${testedVersion}/`);
      return {
        ...endpoint,
        url: updatedUrl,
        versionChanged: true
      };
    }

    console.warn(`⛔️ Version /v${testedVersion}/ liefert Fehlerstruktur – keine gültige API-Version.`);
  } catch (error) {
    console.warn(`⚠️ Fehler beim Prüfen von /v${testedVersion}/: ${error.message}`);
  }

  return { ...endpoint, versionChanged: false };
}

module.exports = { checkAndUpdateApiVersion };
