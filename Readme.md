# 📦 Xentral API Tester

Ein automatisierter API-Tester zur kontinuierlichen Validierung und Überwachung von API-Endpunkten, basierend auf dem Vergleich der tatsächlichen API-Responses mit erwarteten Strukturen.

## 🚀 Features

- Automatische Strukturprüfung von API-Responses
- Dynamische Pfadparameter (z. B. `{id}`) + ID-Autofill
- Automatische API-Versionsprüfung (z. B. `/v1/`, `/v2/`, ...)
- Typprüfung, fehlende & zusätzliche Felder, neue Attribute
- Differenzspeicherung in `_updated[_vX].json` (Versionierung)
- Zustimmung zu Änderungen über Slack notwendig
- Interaktive Slack-Nachrichten mit Block Kit UI
- PIN-Verifizierung via Modal vor finaler Freigabe
- Mehrere Slack-Workspaces unterstützt (`SLACK_BOT_TOKEN_n`)
- Automatische Aktualisierung der ursprünglichen Slack-Nachricht
- Logging von Fehlern und Unterschieden in `logs/`

## 🧱 Projektstruktur

```bash
.
├── core/
│   ├── apiCaller.js           # Führt Request aus, vergleicht mit expected
│   ├── compareStructures.js   # JSON-Strukturvergleich
│   ├── configLoader.js        # Lädt config.json
│   ├── endpointRunner.js      # Testablauf inkl. Versionserkennung
│   ├── fileLogger.js          # Speichert logs (Fehler & Unterschiede)
│   ├── promptHelper.js        # ID-Abfrage für manuelle Tests
│   ├── slackReporter.js       # Erstellt Slack-Testbericht
│   ├── slackWorkspaces.js     # Lädt Slack-Tokens und Secrets
│   ├── validateConfig.js      # Validierung von config.json
│   ├── versionChecker.js      # Prüft URL-Versionen (v1 → v2 ...)
│   └── utils.js               # Hilfsfunktionen (Pfadlösung, Cleanup ...)
│
├── expected/                  # Erwartete Strukturen
├── logs/                      # Fehler und Differenzen
├── responses/                 # Gespeicherte Originalantworten (optional)
├── requestBodies/             # JSON-Payloads für POST/PUT/PATCH
├── default-ids.json           # Fallback IDs
├── config.json                # Test-Konfiguration
├── pending-approvals.json     # Temporäre Zustimmungsverwaltung
├── slackInteractiveServer.js  # Express-Server für Slack-Modals & Buttons
└── index.js                   # Hauptausführung
```

## 🔧 Beispiel `config.json`

```json
{
  "name": "Get View Customer",
  "url": "https://${XENTRAL_ID}.xentral.biz/api/v1/customers/{id}",
  "method": "GET",
  "requiresId": true,
  "expectedStructure": "expected/Get_View_Customer_updated_v2.json"
}
```

## 🧪 Testablauf

1. **Version prüfen**  
   - `/v1/` → `/v2/` → `/v3/` etc.
   - Wenn neuer Pfad → config.json aktualisiert, Test pausiert

2. **Struktur vergleichen**  
   - Felder: fehlend, neu, Typabweichungen
   - Änderungen → neue Struktur gespeichert (`_updated`, `_updated_v2`, ...)
   - Zustimmung via Slack notwendig zur Übernahme

## 📤 Slack-Integration

- Slack-Report enthält:
  - ✅ Erfolgreiche Tests
  - 🟠 Abweichungen (Warnings)
  - 🔴 Kritische Fehler (Timeout, 500er ...)
  - 🔄 Automatisch erkannte neue API-Versionen

- Interaktive Block-Kit Nachrichten:
  - `✅ Einverstanden` → Modal mit PIN-Abfrage
  - `⏸️ Warten` → Struktur wird nicht übernommen
  - Bei Erfolg → Originalnachricht wird aktualisiert mit:  
    `✅ Freigegeben durch <DisplayName>`

## 🔐 PIN-Verifizierung

- Modal wird geöffnet bei Klick auf ✅
- Eingabe der PIN (aus `.env`) ist erforderlich
- Erst nach korrekter Eingabe wird die `config.json` aktualisiert
- Gilt global für alle Workspaces

## ⚙️ .env-Konfiguration

```env
XENTRAL_ID=deine_subdomain
BEARER_TOKEN=abc123456...

SLACK_BOT_TOKEN_1=xoxb-...
SLACK_CHANNEL_ID_1=C0123456789
SLACK_SIGNING_SECRET_1=...

# (optional weitere Workspaces)
SLACK_BOT_TOKEN_2=...
SLACK_CHANNEL_ID_2=...
SLACK_SIGNING_SECRET_2=...

SLACK_APPROVE_PIN=1234
DISABLE_SLACK=false
```

## ▶️ Nutzung

```bash
# Alle Tests automatisch ausführen
node index.js

# Einzelner Test (z. B. bei requiresId)
node index.js "Get View Customer" --id=4711
```

## 🌐 Slack Interaktivität

```bash
# Lokalen Server starten (empfängt Slack-Interaktionen)
node slackInteractiveServer.js

# Über ngrok öffentlich erreichbar machen:
ngrok http 3001
```

## 🧠 Hinweise

- Jede API-Strukturänderung erfordert Zustimmung über Slack
- Zustimmung wird durch Eingabe der PIN verifiziert
- Alte erwartete Strukturen bleiben erhalten (Historie)
- Logs befinden sich in `logs/errors.log` und `logs/differences.log`
- Nachrichten in Slack werden bei Zustimmung automatisch aktualisiert