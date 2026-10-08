import type { ItemCatalogo } from './tipos';
// Catalogo da especificacao; referencias oficiais consultadas em 2026-10-08. OAuth: fase B.
export const catalogo: ItemCatalogo[] = [
  {
    id: 'figma',
    nome: 'Figma',
    descricao: 'Read designs and edit the canvas.',
    url: 'https://mcp.figma.com/mcp',
    autenticacao: ['oauth'],
    escopos: [],
    requisitos: ['OAuth is planned for phase 0.4.0-b.'],
    documentacao: 'https://developers.figma.com/docs/figma-mcp-server/',
    fase: 'b',
  },
  {
    id: 'github',
    nome: 'GitHub',
    descricao: 'Repositories, issues and pull requests.',
    url: 'https://api.githubcopilot.com/mcp/',
    autenticacao: ['token', 'oauth'],
    escopos: ['repo', 'read:org'],
    requisitos: [
      'Personal access token with minimum permissions for the selected repositories. Repository writes count as publishing.',
    ],
    documentacao: 'https://github.com/github/github-mcp-server',
    fase: 'a',
  },
  {
    id: 'supabase',
    nome: 'Supabase',
    descricao: 'Projects, database and development tools.',
    url: 'https://mcp.supabase.com/mcp',
    autenticacao: ['token', 'oauth'],
    escopos: [],
    requisitos: ['Personal access token; optional project scope and read-only mode.'],
    documentacao: 'https://supabase.com/docs/guides/ai-tools/mcp',
    fase: 'a',
  },
  {
    id: 'notion',
    nome: 'Notion',
    descricao: 'Workspace content and pages.',
    url: 'https://mcp.notion.com/mcp',
    fallbackSse: 'https://mcp.notion.com/sse',
    autenticacao: ['oauth'],
    escopos: [],
    requisitos: ['OAuth is planned for phase 0.4.0-b.'],
    documentacao: 'https://developers.notion.com/guides/mcp/overview',
    fase: 'b',
  },
  ...[
    ['gmail', 'Gmail', 'gmailmcp', 'Gmail creates drafts; it does not send email.'],
    ['google-drive', 'Google Drive', 'drivemcp', 'Files and search.'],
    ['google-calendar', 'Google Calendar', 'calendarmcp', 'Calendars and events.'],
  ].map(([id, nome, host, descricao]): ItemCatalogo => ({
    id,
    nome,
    descricao,
    url: `https://${host}.googleapis.com/mcp/v1`,
    autenticacao: ['oauth_cliente_proprio'],
    escopos:
      id === 'gmail'
        ? [
            'https://www.googleapis.com/auth/gmail.readonly',
            'https://www.googleapis.com/auth/gmail.compose',
          ]
        : [],
    requisitos: [
      'Google Developer Preview; user-owned client ID/secret and enabled MCP APIs. OAuth is planned for phase 0.4.0-b.',
    ],
    documentacao: 'https://developers.google.com/workspace/guides/configure-mcp-servers',
    fase: 'b',
    preview: true,
  })),
  ...[
    ['m365-mail', 'Microsoft 365 Mail', 'mcp_MailTools'],
    ['m365-calendar', 'Microsoft 365 Calendar', 'mcp_CalendarTools'],
  ].map(([id, nome, servidor]): ItemCatalogo => ({
    id,
    nome,
    descricao: 'Work IQ integration.',
    url: `https://agent365.svc.cloud.microsoft/agents/tenants/{tenantId}/servers/${servidor}`,
    autenticacao: ['oauth_cliente_proprio'],
    escopos: [],
    requisitos: [
      'Microsoft preview; Microsoft 365 Copilot and a user-owned Entra ID app. OAuth is planned for phase 0.4.0-b. The endpoint depends on the tenant.',
    ],
    documentacao: 'https://learn.microsoft.com/microsoft-agent-365/tooling-servers-overview',
    fase: 'b',
    preview: true,
  })),
  {
    id: 'personalizada',
    nome: 'Custom MCP server',
    descricao: 'Server not verified by Orquestrador.',
    autenticacao: ['token', 'nenhuma', 'oauth'],
    escopos: [],
    requisitos: ['Provide an HTTP/SSE URL or a stdio command. OAuth is planned for phase 0.4.0-b.'],
    documentacao: 'https://modelcontextprotocol.io',
    fase: 'a',
  },
];
