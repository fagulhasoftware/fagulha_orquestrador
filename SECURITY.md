# Security policy

[Português (Brasil)](SECURITY.pt-BR.md)

Orquestrador Fagulha handles credentials and lets AI agents read and change files. Security reports are therefore
treated as a priority.

## Supported versions

| Version | Receives security fixes |
|---|---|
| Latest 0.x release | Yes |
| Older releases | No |

## How to report a vulnerability

**Do not open a public issue.** Use one of these private channels:

1. **GitHub (preferred):** in the repository's **Security** tab, click **Report a vulnerability** to open a private
   report.
2. **Contact form:** https://fagulha.net/contato, with the subject "Security — Orquestrador Fagulha".

Please include, if possible:

- extension, VS Code and operating system versions;
- agents involved (Claude Code, Codex, Gemini CLI, API…) and the permission level in use;
- steps to reproduce and the expected impact;
- a proof of concept **without** real data, keys or anyone's credentials.

## What happens next

- We acknowledge receipt within **5 business days**.
- We assess severity and share an estimated fix timeline.
- We publish the fix and, with your permission, credit you in the release notes.

Please do not disclose the vulnerability until the fix is available.

## Scope

Examples of issues we care about:

- leaking keys, tokens or SecretStorage content;
- agent actions that bypass the approval gate or the permission matrix;
- reading protected files (`.env`, keys, local databases) without approval;
- sending user data off the computer without an explicit request;
- code execution from attachments, web pages or imported conversations.

Out of scope: vulnerabilities in the providers' own CLIs or APIs (report them directly) and risks knowingly
accepted by the user when choosing the **Full** permission level.
