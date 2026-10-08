# Orquestrador Fagulha

[English](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/README.md) · [Português (Brasil)](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/README.pt-BR.md) · [Español](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/README.es.md) · **Deutsch**

Ein privater Chatraum in VS Code, in dem deine KI-Agenten — Claude Code, Codex, Gemini CLI, Ollama und
Modelle per API-Schlüssel — miteinander und mit dir sprechen, teilen, was sie lesen und schreiben, und nur
innerhalb der Berechtigungen handeln, die du festlegst.

Alles läuft **auf deinem Computer**. Es gibt keinen Fagulha-Server, kein Fagulha-Konto und keine Synchronisierung.

## Funktionen

- **Ein Raum pro VS-Code-Fenster**: erwähne `@claude`, `@codex`, `@gemini` oder `@todos` (alle), um die
  Agenten aufzurufen. Ein Agent kann das Wort an einen anderen weitergeben, indem er ihn erwähnt.
- **Deine Agenten, deine Anmeldungen**: melde dich im Browser mit deinem Claude- oder ChatGPT-Konto an oder
  nutze API-Schlüssel (OpenAI, Anthropic, Google AI Studio, OpenAI-kompatible Server). Schlüssel werden beim
  Anbieter geprüft, bevor sie im sicheren Speicher von VS Code abgelegt werden.
- **Drei Berechtigungsstufen**, beim ersten Start gewählt:
  - **Manuell** — du gibst 100 % der Aktionen der Agenten frei;
  - **Teilweise** — frei im Projektordner, Freigabe für alles andere;
  - **Vollständig** — voller Zugriff; bekannte unumkehrbare externe Befehle verlangen eine Bestätigung.
- **Modi pro Agent**: Lesen und Schreiben, nur Lesen oder nur Schreiben, plus eine frei wählbare Rolle
  (z. B. „Architekt“, „Reviewer“).
- **Anhänge**: Text, Code, Markdown, Bilder, PDF und Word. Bilder erreichen die Agenten als Bilder.
  Tabellen werden nie vollständig gelesen: gesendet werden nur Kopfzeile und eine Stichprobe von Zeilen.
- **Agentenphasen und geführte Fragen**: verfolge, was jeder Agent gerade tut, und erhalte Fragen mit
  vorgeschlagenen Antworten, wenn eine Entscheidung nötig ist; der Raum pausiert bis zu deiner Antwort.
- **Sprachchat**: sprich über das Mikrofon mit dem Raum und höre die Antworten. Transkription (whisper.cpp)
  und Sprachausgabe (Systemstimme) laufen lokal; die Aufnahme wird nach der Transkription gelöscht.
  Sprachkomponenten werden nur mit deiner Zustimmung heruntergeladen.
- **Chats und dauerhaftes Gedächtnis**: alle Unterhaltungen bleiben im Menü **Chats** (durchsuchbar) und
  kehren beim erneuten Öffnen von VS Code zurück; **Neuer Chat** beginnt neu, ohne etwas zu verlieren. Das
  **Gedächtnis** speichert Vorlieben und Entscheidungen, die die Agenten in jedem Chat erhalten.
- **Kontext aus anderen Chats**: importiere frühere Unterhaltungen aus Claude Code, Codex oder anderen Räumen.
- **Erweiterbar**: neue Agenten über Manifeste oder andere Erweiterungen (`FagulhaSoftware.orquestrador-fagulha`).

## Voraussetzungen

- VS Code 1.95 oder neuer.
- Mindestens ein Agent: [Claude Code](https://code.claude.com), [Codex](https://developers.openai.com/codex),
  [Gemini CLI](https://geminicli.com), lokales [Ollama](https://ollama.com) oder ein kompatibler API-Schlüssel.

Orquestrador Fagulha enthält und verkauft keinen Modellzugang: Jede Person nutzt ihre eigenen Konten und
bezahlt die Anbieter direkt, falls Kosten anfallen.

## Installation

- **Über den VS Code Marketplace:** Erweiterungen öffnen (`Strg+Umschalt+X`), nach **Orquestrador Fagulha**
  suchen und **Installieren** klicken.
- **Über eine `.vsix`-Datei:** unter
  [Releases](https://github.com/fagulhasoftware/fagulha_orquestrador/releases) herunterladen und
  *Erweiterungen → `...` → Aus VSIX installieren* wählen.

## Erste Schritte

1. Öffne **Orquestrador Fagulha** in der Aktivitätsleiste.
2. Folge dem Assistenten: Agenten auswählen, anmelden und Berechtigungsstufe festlegen.
3. Schreibe im Raum und erwähne einen Agenten, zum Beispiel: `@claude erkläre die Struktur dieses Projekts`.

## Datenschutz

- Unterhaltungen, Aktionen, Freigaben und Anhänge werden nur in `~/.orquestra/dados` auf deinem Computer gespeichert.
- Zugangsdaten liegen im SecretStorage von VS Code und werden nie in Dateien, Protokolle oder die lokale
  Datenbank geschrieben.
- Keine Telemetrie. Die einzigen Netzwerkverbindungen sind die, die du oder deine Agenten zu den von dir
  konfigurierten Anbietern aufbauen.

Details in [PRIVACY.md](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/PRIVACY.md) (auf Englisch).

## Bekannte Einschränkungen

- Sprache: automatische Installation der Komponenten unter Windows; unter macOS und Linux zeigt der Assistent
  den Befehl zur Installation von ffmpeg und whisper.cpp.
- `.xls`-, `.xlsb`- und `.ods`-Tabellen werden abgelehnt; bitte in `.xlsx` oder `.csv` umwandeln.
- Die Oberfläche wird gerade übersetzt; einige Meldungen können noch auf Portugiesisch erscheinen.

## Mitwirken

Beiträge sind willkommen! Bitte lies den
[Leitfaden für Beiträge](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/CONTRIBUTING.md) und den
[Verhaltenskodex](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/CODE_OF_CONDUCT.md).
Sicherheitslücken bitte gemäß der
[Sicherheitsrichtlinie](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/SECURITY.md) melden, niemals in öffentlichen Issues.

## Urheberschaft und Lizenz

Ein Produkt von **Fagulha Software**, entwickelt mit Codex (OpenAI) und Claude (Anthropic). Anerkannter Beitrag:
Fagulha Software 50 %, Codex 30 %, Claude 20 % ([AUTHORS.md](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/AUTHORS.md)).
[MIT](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/LICENSE) © Fagulha. Claude, Codex, ChatGPT, Gemini und Ollama sind Marken
ihrer jeweiligen Inhaber; Orquestrador Fagulha ist mit diesen Werkzeugen kompatibel, ohne offizielle Verbindung oder Billigung.
