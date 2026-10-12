# Changelog

## 0.4.8

- Re-register dynamic OAuth clients on a fresh interactive login without saved tokens; preserve explicitly configured OAuth clients.
- Clarify that the remote Figma MCP requires an approved client, based on a live registration rejection and the vendor documentation.
- Validate browser authorization and live MCP tool discovery for Supabase, Canva and Notion; record provider-specific blockers separately.

## 0.4.7

- Close browser preconnection sockets when finishing MCP OAuth so callback cleanup cannot leave the integration stuck connecting.
- Change the browser callback confirmation to distinguish received authorization from a validated MCP connection.
- Add regression coverage for a browser socket opened without an HTTP request.

## 0.4.6

- Use the Canva MCP endpoint with dynamic OAuth registration and browser sign-in by default, without requiring user API credentials.

## 0.4.5

- Fix Mistral delegated browser authentication: send start/complete actions and attempt IDs in ACP `_meta`, matching the installed official client protocol.
- Require completion of the original attempt and successful credential persistence before confirming login; report local persistence failure separately.
- Regression fixtures now reject misplaced authentication fields and cover mismatched attempts and failed persistence.

## 0.4.4

- Separate native-account authentication from API-key participants; remove Console/API login choices from Claude/Codex account participants and show authentication source in the UI and room context.
- Remove inherited model credentials from CLI environments and enforce account-only Claude/Codex sessions with authentication preflight before inference. Prefer the installed Claude extension runtime over an older PATH binary.
- Add Mistral Vibe and Mistral Code Enterprise ACP participants with independent browser-login profiles, native status, streaming, session resume, room MCP, single-call permission handling and process cancellation.
- Isolate Mistral profiles from the global Vibe keyring and reject environment/global credentials. ACP initially requires Total/read-write on Windows/Linux; macOS refuses until native Keychain isolation is supported.
- Add a separate Mistral API participant with its own SecretStorage key, endpoint, model and shared tool gateway.

## 0.4.3

- Show application icons in the integration catalog, native Codex resources and specialist suggestions; include native app descriptions.
- Default Supabase to browser OAuth; require a registered OAuth client for GitHub browser login and clarify provider prerequisites.
- Rebuild authentication fields when the method changes and clear secret inputs on switching, submission and cancellation.
- Honor MCP authentication challenges and scopes; allow SDK OAuth discovery and refresh across authorization-server origins without forwarding manual bearer tokens.
- Show masked connection diagnostics and disable incomplete Microsoft tenant endpoints.

## 0.4.2

- Separate `@participants`, `#specialists` and `/room commands`, with autocomplete.
- Preserve native Codex Apps and Claude/Antigravity skills/plugins in Total; show actual Codex app metadata separately from shared MCP connections.
- Implement MCP OAuth browser authentication with PKCE, state checks and SecretStorage; remove the placeholder OAuth phase rejection.
- Implement local skill discovery, imports, activation and `skill_ler` for shared use.
- Add pause/resume by room context and preserve existing restrictive permission modes.

## 0.4.1

- Independent Antigravity CLI participant (`@antigravity`, `@ag`, `@agy`); Gemini aliases no longer impersonate Antigravity.
- Total/read-write execution; unsupported restrictive modes fail closed pending isolation validation.
- Dedicated Chrome/Edge browser with navigation, page state, form fill, confirmed clicks and PNG screenshots through the room MCP.
- Browser uses a temporary profile and closes with the room; no personal browser session is attached.

## 0.4.0 — Phase A (local preparation, not published)

- Complete integration catalog and token connections for GitHub, Supabase and custom HTTP/SSE MCP servers; local stdio servers are also supported.
- A shared MCP gateway offers prefixed tools to Claude, Codex, Gemini and API agents. Calls go through the approval gate with categories derived from names and MCP annotations.
- Tokens are validated with `tools/list` before saving to SecretStorage; global configuration contains no credentials. Disconnecting deletes the local credential.
- Enable/disable integrations, reconnect, emit v6 events and update room counters. External results remain explicitly untrusted, including images and structured responses.
- Claude's v6 interface is connected to the host. OAuth and skills remain planned for phases B/C; Marketplace publication requires those phases and real Figma/GitHub validation.

## 0.3.3

- **Fixed: Claude could not use tools on the Partial and Full levels.** Recent Claude Code versions send an extra
  field (`tool_use_id`) in permission requests, which the approval gate rejected with "unknown argument". The gate
  now accepts the current format and ignores unknown fields, so future Claude Code updates do not lock tools again.
- Claude can read images attached to the current message without an extra approval.
- Tools from your own MCP servers (Figma, Supabase, GitHub, Gmail…) used by Claude now go through the approval
  gate as external actions instead of being refused; names like delete/drop/destroy are treated as irreversible and
  send/publish as publication.
- Claude's internal planning tools (task list, plan mode, sub-agents) are no longer refused.
- Clearer refusal messages that name the tool and the reason.
- `/stop` (also `/parar`, `/detener`, `/stoppen`) stops the current agent.
- New command reference in four languages: [docs/COMMANDS.md](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/docs/COMMANDS.md).

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
