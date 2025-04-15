// core/slackWorkspaces.js

/**
 * Lädt alle Slack Workspaces dynamisch anhand der ENV-Variablen.
 * Unterstützt beliebig viele SLACK_BOT_TOKEN_n, SLACK_CHANNEL_ID_n, SLACK_SIGNING_SECRET_n.
 */
function getSlackWorkspaces() {
    const workspaces = [];
    const env = process.env;
    let i = 1;
  
    while (env[`SLACK_BOT_TOKEN_${i}`] && env[`SLACK_CHANNEL_ID_${i}`]) {
      workspaces.push({
        token: env[`SLACK_BOT_TOKEN_${i}`],
        channel: env[`SLACK_CHANNEL_ID_${i}`],
        signingSecret: env[`SLACK_SIGNING_SECRET_${i}`] || ""
      });
      i++;
    }
  
    return workspaces;
  }
  
  module.exports = { getSlackWorkspaces };  