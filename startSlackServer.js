// startSlackServer.js – Einstiegspunkt für Slack Interactive Server

require("dotenv").config(); // .env laden
const app = require("./slackInteractiveServer");

// Starte den Server
const PORT = process.env.SLACK_SERVER_PORT || 3001;
app.listen(PORT, () => {
  console.log(`⚡️ Slack Interactive Server läuft auf Port ${PORT}`);
});
