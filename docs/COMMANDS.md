# Commands and shortcuts

**English** · [Português (Brasil)](COMMANDS.pt-BR.md) · [Español](COMMANDS.es.md) · [Deutsch](COMMANDS.de.md)

Everything you can type, click or configure in Orquestrador Fagulha, and when to use it.

## 1. Calling agents in the room

| Write | What happens | When to use |
|---|---|---|
| `@claude …` | Sends the message to Claude Code | Planning, architecture, reviews, long explanations |
| `@codex …` | Sends the message to Codex | Implementation, refactoring, running and fixing tests |
| `@gemini …` (also `@ag`, `@antigravity`) | Sends the message to Gemini CLI | Second opinion, research, large-context reading |
| `@ollama …` | Sends the message to your local Ollama model | Offline work, private drafts, quick questions |
| `@openai …`, `@anthropic …`, `@geminiapi …`, `@openaicompativel …` | Sends the message to an API-key agent | When you use a provider through an API key instead of a CLI |
| `@todos …` | Sends the message to every enabled agent | Ask everyone for an opinion, compare answers |
| A message **without** a mention | Recorded in the room only; no agent is called | Notes, context for later, instructions you will refer to |
| An agent writing `@codex …` in its answer | Hands the turn to that agent | Agents pass work to each other (limit: *Automatic hand-offs*, section 6) |

Tip: type `@` in the message box to get suggestions; ↑/↓ choose, Enter or Tab insert, Esc closes.

## 2. Chat commands

| Command | What it does | When to use |
|---|---|---|
| `/stop` (also `/parar`, `/detener`, `/stoppen`) | Stops the agent that is working and clears the queue | The agent took a wrong path or is taking too long |
| `/remember <text>` (also `/lembrar`, `/recordar`, `/merken`) | Saves `<text>` in this project's memory | Decisions and conventions of this project ("use pnpm", "API in /services/api") |
| `/remember-global <text>` (also `/lembrar-global`) | Saves `<text>` in the global memory | Personal preferences valid for every project ("answer formally") |

Memories are sent to every agent in every chat (Chats → Memory lets you edit, disable or delete them). Never store
passwords or keys in memory.

## 3. Keyboard

| Keys | Where | Action |
|---|---|---|
| `Enter` | Message box | Send |
| `Shift+Enter` | Message box | New line |
| `Ctrl+Alt+V` (`Cmd+Alt+V` on macOS) | With the Orquestrador panel open | Start / stop voice recording |
| `1`–`6` | Guided question box | Choose an option of the first unanswered question |
| `Enter` | Guided question box | Send the answers |
| `Esc` | Guided question box | Skip the question |
| `Enter` / `Esc` | Renaming a chat | Save / cancel |

## 4. Buttons in the room

| Button | Where | When to use |
|---|---|---|
| **Stop** (square) | Header, while an agent works | Same as `/stop` |
| **New chat** (+) | Header | Start a clean conversation; the current one stays in Chats |
| **Chats and memory** | Header | Find, reopen, pin, rename, export or delete conversations; manage memories |
| **Agents** | Header | Enable agents, sign in, set role and permission mode |
| **Settings** (gear) | Header | Permission level, nickname, topic, limits, voice, export |
| **Automatic reading** (speaker) | Header | Turn on/off reading answers aloud |
| **Attach** (paper clip) | Message box | Attach files; you can also paste images or drag files (including from the Explorer) |
| **Add context** | Message box | Import a previous Claude Code, Codex or room conversation |
| **Microphone** | Message box | Speak instead of typing (local transcription) |
| **Listen** (speaker on an answer) | Each agent answer | Hear that answer |
| **Approve / Approve for session / Deny** | Approval card | Decide on an agent action. *Approve for session* allows the same kind of action from that agent until the session ends |
| **Answer / Skip** | Guided question box | Reply to an agent question; the room pauses until you do |

## 5. VS Code commands (Command Palette: `Ctrl+Shift+P`)

| Command | When to use |
|---|---|
| `Orquestrador Fagulha: Abrir no editor` (Open in editor) | Open the room in a large editor tab instead of the sidebar |
| `Orquestrador Fagulha: Falar / parar` (Speak / stop) | Start or stop voice recording (same as `Ctrl+Alt+V`) |
| `Developer: Reload Window` | After installing or updating the extension |

## 6. Settings (`Ctrl+,` → search "fagulha")

| Setting | Default | When to change |
|---|---|---|
| `fagulha.nivel` | `manual` | Initial permission level. Change it in the panel (Full requires typed confirmation) |
| `fagulha.passagensAutomaticas` | `6` | How many times agents may hand off to each other automatically; `0` turns hand-offs off |
| `fagulha.timeoutMinutos` | `20` | Maximum time for one agent answer |
| `fagulha.anexos.*` | see panel | Attachment limits (text, images, PDF/Word, spreadsheets) |
| `fagulha.provedores.claude.comando`, `.codex.comando`, `.gemini.comando` | auto-detect | Only if the CLI is installed in an unusual place |
| `fagulha.provedores.ollama.modelo` / `.baseUrl` | auto | Choose the Ollama model or a remote Ollama address |
| `fagulha.provedores.openai-compativel.modelo` / `.baseUrl` | — | Use any OpenAI-compatible server (LM Studio, vLLM, OpenRouter…) |
| `fagulha.provedores.anthropic.modelo`, `.gemini-api.modelo` | provider default | Choose a specific model for API-key agents |

API keys are never stored in settings: use **Agents → Sign in** (they go to VS Code SecretStorage).

## 7. Permission levels — which one to use

| Level | Use when |
|---|---|
| **Manual** | Sensitive projects, first contact with the extension, or when you want to approve every single action |
| **Partial** (recommended) | Daily work: agents read and write freely inside the project; anything outside asks for approval |
| **Full** | Trusted automation where you accept the risks shown on screen; known irreversible external commands still ask |

## 8. Per-agent modes (Agents → Permission mode)

| Mode | Use when |
|---|---|
| Read and write | The agent implements changes |
| Read only | Reviews, audits, explanations — the agent must not change files |
| Write only | The agent writes only what you attach or describe, without exploring the project |

## 9. Voice

1. Settings → Voice → **Download and install** (one-time, with your consent).
2. Press the microphone or `Ctrl+Alt+V`, speak, then **Stop and transcribe** (or **Stop and send** if automatic sending is on).
3. Say "arroba claude" (or "arroba codex", "arroba todos"…) to mention an agent by voice.
4. Turn on **Automatic reading** to hear questions, announcements and summaries from the agents.
