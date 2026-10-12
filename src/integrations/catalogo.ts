import type { ItemCatalogo } from './tipos';
// MCPs compartilhados. Recursos nativos de cada agente nao dependem deste catalogo.
export const catalogo: ItemCatalogo[] = [
  {
    id: 'figma',
    nome: 'Figma',
    descricao: 'Read designs and edit the canvas.',
    url: 'https://mcp.figma.com/mcp',
    autenticacao: ['oauth'],
    escopos: [],
    requisitos: [
      'O MCP remoto do Figma aceita apenas clientes aprovados no catalogo do fornecedor. O registro OAuth do Fagulha pode ser recusado com HTTP 403 antes do login. Recursos Figma ja conectados ao agente podem ser usados nativamente; acesso compartilhado exige aprovacao do cliente Fagulha.',
    ],
    documentacao: 'https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/',
    fase: 'b',
  },
  {
    id: 'github',
    nome: 'GitHub',
    descricao: 'Repositories, issues and pull requests.',
    url: 'https://api.githubcopilot.com/mcp/',
    autenticacao: ['token', 'oauth_cliente_proprio'],
    escopos: ['repo', 'read:org'],
    requisitos: [
      'Use um personal access token do GitHub. Login OAuth exige seu proprio GitHub OAuth App, Client ID/secret e callback http://127.0.0.1:43219/oauth/callback; o servidor nao oferece registro dinamico.',
    ],
    documentacao: 'https://github.com/github/github-mcp-server',
    fase: 'a',
  },
  {
    id: 'supabase',
    nome: 'Supabase',
    descricao: 'Projects, database and development tools.',
    url: 'https://mcp.supabase.com/mcp',
    autenticacao: ['oauth', 'token'],
    escopos: [],
    requisitos: ['Entre pelo navegador sem criar aplicativo OAuth. Token pessoal e uma alternativa; chaves anon/service_role do projeto nao servem para este MCP.'],
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
    requisitos: ['Autorize o workspace do Notion pelo navegador.'],
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
      'Google Developer Preview; exige Client ID/secret proprio, APIs MCP habilitadas e redirect http://127.0.0.1:43219/oauth/callback.',
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
      'Microsoft preview; exige aplicativo Entra proprio, Microsoft 365 Copilot e endpoint especifico do tenant. Configure via integracao personalizada.',
    ],
    documentacao: 'https://learn.microsoft.com/microsoft-agent-365/tooling-servers-overview',
    fase: 'b',
    preview: true,
  })),
  {
    id: 'canva',
    nome: 'Canva',
    descricao: 'Designs e edicao via MCP oficial.',
    url: 'https://mcp.canva.com/mcp',
    autenticacao: ['oauth', 'oauth_cliente_proprio'],
    escopos: [],
    requisitos: [
      'Entre pelo navegador com sua conta Canva, sem chave de API. O servidor oferece registro dinamico OAuth; o acesso a equipe e aos recursos depende das permissoes da conta. Cliente proprio e uma opcao avancada e exige cadastro do aplicativo no Canva.',
    ],
    documentacao: 'https://www.canva.dev/docs/apps/mcp/access/',
    fase: 'b',
  },
  {
    id: 'personalizada',
    nome: 'Custom MCP server',
    descricao: 'Server not verified by Orquestrador.',
    autenticacao: ['token', 'nenhuma', 'oauth'],
    escopos: [],
    requisitos: [
      'Informe URL HTTP/SSE ou comando stdio. OAuth remoto suporta navegador, PKCE e cliente proprio.',
    ],
    documentacao: 'https://modelcontextprotocol.io',
    fase: 'a',
  },
];
