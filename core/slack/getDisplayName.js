const axios = require("axios");
const { getSlackWorkspaces } = require("./slackWorkspaces");

/**
 * Holt den Display-Namen eines Slack-Users.
 * @param {string} userId - Slack User-ID (z. B. U123ABC)
 * @param {string} token - Slack Bot Token
 * @returns {Promise<string>} Anzeigename oder Fallback auf ID
 */
async function getDisplayName(userId, token) {
  try {
    const result = await axios.get("https://slack.com/api/users.info", {
      params: { user: userId },
      headers: { Authorization: `Bearer ${token}` }
    });
    if (result.data.ok) {
      const profile = result.data.user.profile;
      return profile.display_name || profile.real_name || userId;
    }
  } catch (err) {
    console.warn("⚠️ Nutzername nicht abrufbar:", err.message);
  }
  return userId;
}

module.exports = { getDisplayName };