// core/slack/openPinModal.js
const axios = require("axios");
const { getSlackWorkspaces } = require("./slackWorkspaces");

/**
 * Öffnet ein Slack Modal zur PIN-Verifizierung für einen bestimmten Endpunkt
 * @param {string} triggerId - Slack Trigger ID aus Button-Interaktion
 * @param {string} endpoint - API-Endpunkt-Name
 * @param {string} messageTs - ursprüngliche Nachricht (für späteres Update)
 * @param {string} channelId - Channel ID (für späteres Update)
 */
async function openPinModal(triggerId, endpoint, messageTs, channelId) {
  const token = getSlackWorkspaces()[0]?.token;
  const privateMetadata = JSON.stringify({
    endpoint,
    original_ts: messageTs,
    channel: channelId
  });

  await axios.post(
    "https://slack.com/api/views.open",
    {
      trigger_id: triggerId,
      view: {
        type: "modal",
        callback_id: "pin_submission",
        private_metadata: privateMetadata,
        title: { type: "plain_text", text: "Verifizierung" },
        submit: { type: "plain_text", text: "Bestätigen" },
        close: { type: "plain_text", text: "Abbrechen" },
        blocks: [
          {
            type: "input",
            block_id: "pin_input",
            label: { type: "plain_text", text: "Bitte PIN eingeben:" },
            element: {
              type: "plain_text_input",
              action_id: "pin",
              placeholder: {
                type: "plain_text",
                text: "nur wenn du richtige PIN hast, kommst du rein ;)"
              }
            }
          }
        ]
      }
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    }
  );
}

module.exports = { openPinModal };
