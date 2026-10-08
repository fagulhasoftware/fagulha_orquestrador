# Changelog

## 0.3.2

- **English is now the native language** of the documentation, with Portuguese (Brazil), Spanish and German
  versions. The interface translation is in progress.
- Times are shown in your computer's time zone, including Markdown export; storage remains in UTC.
- Images from attachments and project files reach agents as real images through MCP. Attachments are listed in
  the agents' context with ID, name, type and size; they can also be read by unique file name.
- Specific error messages for missing attachments, ambiguous names, size limits and unsupported types, without
  exposing internal errors or secrets.
- Images in the current message are passed to the agent CLIs on the Partial and Full levels; Manual keeps reading
  through MCP with approval.
- Guided questions stay docked above the message box; the room pauses (queued messages wait and new messages are
  held) until you answer or skip. Keyboard shortcuts: 1–6 choose, Enter answers, Esc skips.

## 0.3.1

- Execution logs are collapsed into a single line, including single actions and long results; click to see the
  full content.
- Consecutive actions from the same agent share one block with time, agent, count and summary. Messages and errors
  keep their position in the conversation.
- Expanded blocks stay open while the chat updates; long details scroll on their own.

## 0.3.0

- **Agent stages:** see what each agent is doing (thinking, reading, searching the web, writing, running) and a
  clear signal when it finishes, is stopped or hits an error.
- **Guided questions:** when an agent needs a decision, it opens a box with questions and suggested answers and
  waits for your reply before continuing.
- **Single setup:** the setup assistant, permission level and preferences apply to every window and folder.
- **More natural voice:** automatic reading speaks only the agents' questions, the short announcement before
  acting and the summary when done; Piper engine prepared and optional cloud voice with a key validated in
  SecretStorage. Neural pt-BR voice installation waits for a voice with a verified commercial license.
- **Codex on Full:** complete file access, network, live web search and inherited MCP servers, including on resumed
  sessions. Native shell is off; commands run through the room. Full automates common actions and asks for
  confirmation of known irreversible external commands, with its own category and audit. Manual and Partial
  unchanged.

## 0.2.2

- Fixed: Orquestrador tools (web, files, memory) were refused for Claude and Codex before the approval card.
- Bridge diagnostics now distinguish missing variables, revoked token, invalid arguments and gate refusals.

## 0.2.1

- **Chats menu:** all your conversations, from any project and window, with search, pin, rename, export and delete.
- **New chat:** start a clean conversation without losing the previous one.
- **Conversation kept:** when you close and reopen VS Code or open a new window, the folder's last chat comes back.
- **Persistent memory:** preferences and decisions that agents receive in every chat, global or per project.
  Agents can propose memories, saved only with your approval.

## 0.2.0

- **Voice chat:** talk to the room through the microphone; transcription runs on your computer (whisper.cpp,
  `small` model by default) and the recording is deleted afterwards.
- **Listen to answers:** the agents' messages read aloud with your system voice, automatically or per message.
- **Voice setup assistant:** shows the source and size of each component and downloads only with your
  permission, verifying file integrity.
- Repository and issue links on the extension page.

## 0.1.1

- Fixed: starting or resuming Codex conversations failed when plugin MCP servers were installed. On Manual the
  conversation starts only when isolation can be guaranteed; on the other levels the room warns if an inherited
  MCP server stays active.
- Obsolete settings in Codex's `config.toml` now produce an informational notice once per session, without marking
  the agent as failed.

## 0.1.0 — 2026-10

First public release.

- One room per window with Claude Code, Codex, Gemini CLI, Ollama and API-key agents.
- Sign in through the browser or with a device code; API keys validated before being stored.
- Manual, Partial and Full permission levels, with approvals and a local audit log.
- Attachments with size limits and spreadsheet sampling.
- Context import from other conversations.
