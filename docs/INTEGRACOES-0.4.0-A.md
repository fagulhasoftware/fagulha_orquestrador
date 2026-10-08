# Integrations — phase 0.4.0-a

The host implements contract v6 on `versao/0.4.0`, based on `versao/0.3.3`. The complete catalog, including disconnected entries and custom connections, is returned by `listarIntegracoes`. Changes emit `integracao`; room state counts connected, active integrations. English source strings for UI translations are in `TEXTOS-INTEGRACOES-0.4.0-A.json`.

GitHub and Supabase personal access tokens and custom HTTP, SSE and stdio MCP connections are supported. OAuth remains phase B; skills remain phase C. The host returns explicit deferred-feature errors and an empty skill list during phase A. Microsoft tenant endpoints require verification during phase B.

Tokens are validated through `tools/list` before saving to VS Code SecretStorage. SQLite stores connection metadata only. Token rotation invalidates pending approvals. Returned tool data is marked untrusted; known secrets are masked. Network redirects do not forward credentials, and authenticated HTTP is restricted to HTTPS or loopback.

The shared gateway exposes tools as `<integrationId>__<tool>` to CLI and API providers. Tool input schemas are validated before execution. Every call passes through the Portão; destructive external actions always require confirmation, including at Total access. Disabled, disconnected or changed connections cannot execute an already pending approval. Images, structured results and MCP error status are preserved.

Validation uses real local HTTP, SSE and stdio MCP servers, simulated provider HTTP endpoints, and SQLite/SecretStorage separation checks. These tests do not prove live cloud credentials, OAuth, Chrome sessions or visual UI behavior. Real Figma/GitHub validation and completion of phases B/C remain release requirements. The local VSIX is a preparation artifact, not a Marketplace release.

Reference endpoints and requirements are recorded in `src/integrations/catalogo.ts`, with links to each service's official documentation.
