# 📦 Xentral API Tester

Ein automatisierter API-Tester zur kontinuierlichen Validierung und Überwachung von API-Endpunkten, basierend auf dem Vergleich der tatsächlichen API-Responses mit erwarteten Strukturen.

## 🚀 Features

- Automatische Strukturprüfung von API-Responses
- Unterstützung dynamischer Pfadparameter (z. B. `{id}`)
- Zwei-Schritt-Versionserkennung (API-Version wird erkannt und später evaluiert)
- Vergleich gegen aktualisierte erwartete Datenstruktur
- Typabweichungs- und Feldvergleich (fehlende/zusätzliche Felder)
- Slack-Benachrichtigung mit detailliertem Fehlerreport
- Speicherung von Logs (Fehler, Differenzen)
- Versionierung aktualisierter Strukturdateien (`_updated`, `_updated_v1`, usw.)

## 🧱 Projektstruktur

```bash
.
├── core/                  # Kernlogik-Module
│   ├── apiCaller.js       # Führt API-Request aus und vergleicht Response mit expected
│   ├── compareStructures.js # Vergleichsfunktion für JSON-Strukturen
│   ├── configLoader.js    # Lädt config.json
│   ├── endpointRunner.js  # Logik für Testablauf einzelner Endpunkte (inkl. Version)
│   ├── fileLogger.js      # Logging in .log-Dateien
│   ├── promptHelper.js    # ID-Abfrage bei fehlendem Parameter
│   ├── slackReporter.js   # Generiert und versendet Slack-Testreport
│   ├── validateConfig.js  # Vorabprüfung config.json + Dateiexistenz
│   ├── versionChecker.js  # Prüft, ob eine neue API-Version existiert
│   └── utils.js           # Kleine Hilfsfunktionen
│
├── expected/              # Erwartete Datenstrukturen (.json)
├── logs/                  # Fehler- und Differenzlogs
├── responses/             # (Optional) Gespeicherte Originalantworten
├── requestBodies/         # JSON-Dateien für POST-/PUT-/PATCH-Requests
├── default-ids.json       # Vorbelegte IDs für GET-Detail-Requests
├── config.json            # API-Endpunktdefinitionen inkl. erwarteter Struktur
└── index.js               # Einstiegspunkt: orchestriert Testablauf
```

## 📄 config.json

Jeder API-Endpunkt ist wie folgt definiert:

```json
{
  "name": "Get View Customer",
  "url": "https://${XENTRAL_ID}.xentral.biz/api/v1/customers/{id}",
  "method": "GET",
  "headers": {
    "Accept": "application/json",
    "Authorization": "Bearer ${BEARER_TOKEN}"
  },
  "requiresId": true,
  "expectedStructure": "expected/Get_View_Customer_updated.json"
}
```

## 🧪 Ablauf (2-Schritt-Logik)

1. **Versionsprüfung**:
   - Prüft, ob eine höhere Version (z. B. v2) existiert
   - Wenn ja → URL und `config.json` aktualisieren, Test abbrechen
2. **Testdurchlauf** (beim nächsten Aufruf):
   - API-Call wird ausgeführt
   - Struktur wird in `expected/` als `_updated(_vX)` gespeichert
   - Unterschiede (fehlende Felder, neue Felder, Typabweichungen) werden erkannt und geloggt

## 📤 Slack-Report

Die Slack-Nachricht enthält:

- Neue erkannte API-Versionen
- Unterschiede je API (fehlende Felder, neue Felder, Typabweichungen)
- Gesamtstatistik
- Status (🟢 / 🟠 / 🔴)

## 🛠 .env-Konfiguration

```
XENTRAL_ID=deine_subdomain
BEARER_TOKEN=abc123456...
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
DISABLE_SLACK=true
```

## ▶️ Start

```bash
# Alle Tests ausführen
node index.js

# Einzelnen Test ausführen
node index.js "Get View Customer"
```

## 📚 Weiteres

- Alte expected-Dateien bleiben erhalten → Vergleichshistorie sichtbar
- Optional: `logs/errors.log` und `logs/differences.log` für manuelle Nachverfolgung