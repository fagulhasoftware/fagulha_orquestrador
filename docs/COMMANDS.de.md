# Befehle und Tastenkürzel

[English](COMMANDS.md) · [Português (Brasil)](COMMANDS.pt-BR.md) · [Español](COMMANDS.es.md) · **Deutsch**

Alles, was du in Orquestrador Fagulha eingeben, anklicken oder einstellen kannst, und wann du es verwendest.

## 1. Agenten im Raum aufrufen

| Eingabe | Was passiert | Wann verwenden |
|---|---|---|
| `@claude …` | Sendet die Nachricht an Claude Code | Planung, Architektur, Reviews, ausführliche Erklärungen |
| `@codex …` | Sendet die Nachricht an Codex | Umsetzung, Refactoring, Tests ausführen und reparieren |
| `@gemini …` (auch `@ag`, `@antigravity`) | Sendet die Nachricht an Gemini CLI | Zweitmeinung, Recherche, großer Kontext |
| `@ollama …` | Sendet die Nachricht an dein lokales Ollama-Modell | Offline-Arbeit, private Entwürfe, schnelle Fragen |
| `@openai …`, `@anthropic …`, `@geminiapi …`, `@openaicompativel …` | Sendet die Nachricht an einen Agenten mit API-Schlüssel | Wenn du einen Anbieter per API-Schlüssel statt per CLI nutzt |
| `@todos …` | Sendet die Nachricht an alle aktivierten Agenten | Alle nach ihrer Meinung fragen, Antworten vergleichen |
| Nachricht **ohne** Erwähnung | Wird nur im Raum gespeichert; kein Agent wird aufgerufen | Notizen, Kontext für später |
| Ein Agent schreibt `@codex …` in seiner Antwort | Übergibt das Wort an diesen Agenten | Agenten geben Arbeit weiter (Limit: *Automatische Übergaben*, Abschnitt 6) |

Tipp: Tippe `@` im Nachrichtenfeld für Vorschläge; ↑/↓ wählen, Enter oder Tab fügen ein, Esc schließt.

## 2. Chat-Befehle

| Befehl | Was er tut | Wann verwenden |
|---|---|---|
| `/stoppen` (auch `/stop`) | Stoppt den arbeitenden Agenten und leert die Warteschlange | Der Agent ist auf dem falschen Weg oder braucht zu lange |
| `/merken <Text>` (auch `/remember`) | Speichert `<Text>` im Gedächtnis dieses Projekts | Entscheidungen und Konventionen des Projekts |
| `/merken-global <Text>` (auch `/remember-global`) | Speichert `<Text>` im globalen Gedächtnis | Persönliche Vorlieben für alle Projekte |

Speichere niemals Passwörter oder Schlüssel im Gedächtnis.

## 3. Tastatur

| Tasten | Wo | Aktion |
|---|---|---|
| `Enter` / `Umschalt+Enter` | Nachrichtenfeld | Senden / neue Zeile |
| `Strg+Alt+V` (`Cmd+Alt+V` auf macOS) | Bei geöffnetem Panel | Sprachaufnahme starten / stoppen |
| `1`–`6` / `Enter` / `Esc` | Feld für geführte Fragen | Option wählen / senden / überspringen |

## 4. Schaltflächen im Raum

| Schaltfläche | Wann verwenden |
|---|---|
| **Stoppen** | Wie `/stoppen` |
| **Neuer Chat** (+) | Eine neue Unterhaltung beginnen; die aktuelle bleibt unter Chats |
| **Chats und Gedächtnis** | Unterhaltungen suchen, öffnen, anheften, umbenennen, exportieren, löschen; Erinnerungen verwalten |
| **Agenten** | Agenten aktivieren, anmelden, Rolle und Berechtigungsmodus festlegen |
| **Einstellungen** | Berechtigungsstufe, Spitzname, Thema, Grenzen, Sprache, Export |
| **Anhängen** | Dateien anhängen; Bilder einfügen oder Dateien hineinziehen ist ebenfalls möglich |
| **Kontext hinzufügen** | Eine frühere Unterhaltung aus Claude Code, Codex oder einem Raum importieren |
| **Mikrofon** / **Anhören** | Sprechen statt tippen / eine Antwort anhören |
| **Freigeben / Für die Sitzung freigeben / Ablehnen** | Über eine Aktion eines Agenten entscheiden |
| **Antworten / Überspringen** | Eine Frage eines Agenten beantworten; der Raum pausiert bis zu deiner Antwort |

## 5. VS-Code-Befehle (`Strg+Umschalt+P`)

| Befehl | Wann verwenden |
|---|---|
| `Orquestrador Fagulha: Abrir no editor` | Den Raum in einem großen Editor-Tab öffnen |
| `Orquestrador Fagulha: Falar / parar` | Sprachaufnahme starten oder stoppen |
| `Developer: Reload Window` | Nach Installation oder Update der Erweiterung |

## 6. Einstellungen (`Strg+,` → nach „fagulha“ suchen)

| Einstellung | Standard | Wann ändern |
|---|---|---|
| `fagulha.nivel` | `manual` | Anfangsstufe der Berechtigungen (Vollständig verlangt eine getippte Bestätigung im Panel) |
| `fagulha.passagensAutomaticas` | `6` | Wie oft Agenten das Wort automatisch weitergeben dürfen; `0` schaltet ab |
| `fagulha.timeoutMinutos` | `20` | Maximale Zeit für eine Antwort |
| `fagulha.anexos.*` | siehe Panel | Grenzen für Anhänge |
| `fagulha.provedores.*` | automatische Erkennung | CLI-Pfad, Modell oder Adresse von Ollama / OpenAI-kompatiblen Servern |

API-Schlüssel werden nie in den Einstellungen gespeichert: nutze **Agenten → Anmelden**.

## 7. Berechtigungsstufen

| Stufe | Verwenden, wenn |
|---|---|
| **Manuell** | Sensible Projekte oder erster Kontakt: du gibst jede Aktion frei |
| **Teilweise** (empfohlen) | Täglicher Einsatz: frei im Projekt, Freigabe für alles andere |
| **Vollständig** | Vertrauenswürdige Automatisierung mit akzeptierten Risiken; bekannte unumkehrbare externe Befehle fragen weiterhin nach |

## 8. Sprache

1. Einstellungen → Stimme → **Herunterladen und installieren** (einmalig, mit deiner Zustimmung).
2. Mikrofon klicken oder `Strg+Alt+V`, sprechen und **Stoppen und transkribieren** wählen.
3. Sage „arroba claude“ (oder „arroba codex“…), um einen Agenten per Sprache zu erwähnen.
4. Aktiviere das **automatische Vorlesen**, um Fragen, Ankündigungen und Zusammenfassungen zu hören.
