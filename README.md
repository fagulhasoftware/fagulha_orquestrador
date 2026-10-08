# Orquestrador Fagulha

**English** · [Português (Brasil)](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/README.pt-BR.md) · [Español](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/README.es.md) · [Deutsch](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/README.de.md)

A private chat room inside VS Code where your AI agents — Claude Code, Codex, Gemini CLI, Ollama and
API-key models — talk to each other and to you, share what they read and write, and only act within the
permissions you set.

Everything happens **on your computer**. There is no Fagulha server, no Fagulha account and no sync.

## Features

- **One room per VS Code window**: mention `@claude`, `@codex`, `@gemini` or `@todos` (everyone) to call
  the agents. An agent can hand the turn to another by mentioning it.
- **Your agents, your logins**: sign in with your Claude or ChatGPT account in the browser, or use API keys
  (OpenAI, Anthropic, Google AI Studio, OpenAI-compatible servers). Keys are tested with the provider before
  being stored in VS Code's secure storage.
- **Three permission levels**, chosen on first run:
  - **Manual** — you approve 100% of the agents' actions;
  - **Partial** — free inside the project folder, approval for everything else;
  - **Full** — complete access; known irreversible external commands ask for confirmation.
    Codex gets network, web search and your inherited MCP servers; commands run through the room.
- **Per-agent modes**: read and write, read-only or write-only, plus a free-form role
  (e.g. "architect", "reviewer").
- **Attachments**: text, code, Markdown, images, PDF and Word. Images reach the agents as images.
  Spreadsheets are never read in full: Orquestrador sends only the header and a sample of rows, with a size
  limit.
- **Agent stages and guided questions**: follow what each agent is doing and get questions with suggested
  answers when it needs a decision; the room pauses until you answer.
- **Voice chat**: talk to the room through your microphone and listen to the agents' answers.
  Transcription (whisper.cpp) and speech (your system voice) run on your computer; the recording is deleted
  after transcription. Voice components are downloaded only with your permission.
- **Chats and persistent memory**: every conversation stays in the **Chats** menu (searchable) and comes
  back when you reopen VS Code; **New chat** starts fresh without losing anything. **Memory** keeps
  preferences and decisions that agents receive in every chat; proposals are saved automatically on Full
  and ask for your approval on the other levels.
- **Context from other chats**: import previous Claude Code, Codex or room conversations.
- **Extensible**: new agents through manifests or other extensions (`FagulhaSoftware.orquestrador-fagulha`).

## Requirements

- VS Code 1.95 or later.
- At least one agent:
  - [Claude Code](https://code.claude.com) (CLI or VS Code extension), with a Claude or Anthropic Console account;
  - [Codex](https://developers.openai.com/codex) (CLI or VS Code extension), with a ChatGPT account or an OpenAI key;
  - [Gemini CLI](https://geminicli.com), with a Google AI Studio key;
  - [Ollama](https://ollama.com), running locally;
  - or an API key from a compatible provider.

Orquestrador Fagulha does not include or resell model access: each user brings their own accounts and pays
the providers directly, when there is a charge.

## Installation

- **From the VS Code Marketplace:** open Extensions (`Ctrl+Shift+X`), search for **Orquestrador Fagulha**
  and click **Install**.
- **From a `.vsix` file:** download the package from
  [Releases](https://github.com/fagulhasoftware/fagulha_orquestrador/releases) and use
  *Extensions → `...` → Install from VSIX*, or `code --install-extension orquestrador-fagulha-<version>.vsix`.

Every installation is independent: Orquestrador starts clean, with no conversations, accounts or settings from
anyone else.

## Getting started

1. Open **Orquestrador Fagulha** in the Activity Bar.
2. Follow the setup: choose your agents, sign in and pick a permission level.
3. Write in the room mentioning an agent, for example: `@claude explain the structure of this project`.

## Privacy

- Conversations, actions, approvals and attachments are stored only in `~/.orquestra/dados`, on your computer.
- Credentials live in VS Code's SecretStorage and are never written to files, logs or the local database.
- No telemetry. The only network connections are the ones you or your agents make to the providers you
  configured yourself.

Details in [PRIVACY.md](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/PRIVACY.md).

## Known limitations

- Voice: components install automatically on Windows; on macOS and Linux the setup shows the command to
  install ffmpeg and whisper.cpp.
- `.xls`, `.xlsb` and `.ods` spreadsheets are rejected; convert them to `.xlsx` or `.csv`.
- The interface is being translated; some messages may still appear in Portuguese.

## Development

Prerequisites: [Node.js](https://nodejs.org) 20 or later, Git and VS Code 1.95 or later.

```bash
git clone https://github.com/fagulhasoftware/fagulha_orquestrador.git
cd fagulha_orquestrador
npm install
npm run build        # builds the extension, the MCP server and the UI into dist/
npm test             # automated tests (no real network, no real accounts)
```

To try it in VS Code, open the project folder and press **F5**: a new "Extension Development Host" window
opens with the extension loaded from source.

Other commands:

| Command | Purpose |
|---|---|
| `npm run check:webview` | Strict type check of the whole project |
| `npm run format` | Formats the code with Prettier |
| `npm run package` | Builds the `.vsix` and runs the package privacy check |
| `npm run smoke:clis` | Detects installed CLIs and prints the generated arguments, without calling models |

The architecture is described in [docs/ARQUITETURA.md](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/docs/ARQUITETURA.md) (Portuguese).

## Contributing

Contributions are welcome: fixes, new agents, UI improvements, documentation and translations.
Please read the [contributing guide](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/CONTRIBUTING.md) and the
[code of conduct](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/CODE_OF_CONDUCT.md) before opening an issue or a pull request.

## Security

Do not report vulnerabilities in public issues. Follow the [security policy](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/SECURITY.md).

## Authors

A **Fagulha Software** product, built with Codex (OpenAI) and Claude (Anthropic).
Acknowledged contribution: Fagulha Software 50%, Codex 30%, Claude 20%. Details in
[AUTHORS.md](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/AUTHORS.md).

## License

[MIT](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/LICENSE) © Fagulha. Claude, Codex, ChatGPT, Gemini and Ollama are trademarks of their
respective owners; Orquestrador Fagulha is compatible with these tools, with no official affiliation or endorsement.

## Codex on the Full level (0.3.0)

Codex gets complete file access in read-and-write mode, live web search, and keeps the MCP servers configured by
the user. Read-only mode keeps the read-only sandbox. The native shell is turned off: commands go through
`comando_executar`, with a timeout, an output limit and auditing. Manual and Partial keep the previous behavior.

On CLI 0.160.0, local verification confirmed web search and no native shell; `apply_patch` was not offered in that
scenario either. Use `arquivo_escrever` to edit files. Availability of native tools may vary with the CLI and the
model.

The approval gate asks for individual confirmation of known external commands for deletion, destruction, forced
push and destructive SQL with an explicit remote host. The classifier is a heuristic: scripts, aliases, implicit
remote connections and tools from inherited MCP servers may perform actions outside that classification. Direct
MCP calls and native edits do not go through the approval gate; guidance in the context is not a technical
barrier. Room tools still refuse known sensitive destinations. Stop is always available. This item covers Codex
access; neural voice and other features planned for 0.3.0 are not included.
