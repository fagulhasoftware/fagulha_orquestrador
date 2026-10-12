# Privacy Policy — Orquestrador Fagulha

Last updated: October 8, 2026. · [Português (Brasil)](PRIVACY.pt-BR.md)

Orquestrador Fagulha is a VS Code extension that runs entirely on the computer where it is installed.
Fagulha does not operate servers for this extension and **does not receive, store or process user data**.

## Data stored on your computer

| Data | Where | Who can access it |
|---|---|---|
| Room conversations, actions, approvals and audit log | `~/.orquestra/dados/orquestra.sqlite` | Only you and the agents you enable |
| Attachments | `~/.orquestra/dados/anexos/` | Only you and the agents you enable |
| API keys | VS Code SecretStorage (operating system vault) | Only the extension, on your computer |
| Claude Code and Codex sign-ins | Managed by the CLIs themselves, in your accounts | The respective providers |

To delete all data, uninstall the extension and remove the `~/.orquestra` folder. Keys can be removed with the
"Sign out" button of each agent.

## Network connections

The extension has no telemetry and no usage analytics. Network connections happen only when:

- you sign in or validate a key with a provider (Anthropic, OpenAI, Google, or the address you configure);
- an agent you called talks to its provider;
- you or an agent, with your approval according to the permission level, open or read a web page;
- you download voice components, after explicit consent (official sources, integrity verified).

Content sent to providers follows each provider's privacy policy. If you enable the optional cloud voice, the
text read aloud (questions, announcements and summaries from the agents) is sent to the voice provider you chose.

## Export

Conversations only leave your computer if you explicitly use the "Export this conversation" command.

## Contact

Fagulha — https://fagulha.net/contato
