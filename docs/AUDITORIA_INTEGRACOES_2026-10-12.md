# Auditoria de login das integracoes — 12/10/2026

Testes locais com a conta solicitada pelo proprietario. Nenhuma credencial,
codigo OAuth ou URL de autorizacao foi gravada neste documento. Os tokens do
harness de teste ficaram somente em memoria; nao foram transferidos ao cofre
da extensao instalada.

| Integracao | Evidencia real | Resultado |
| --- | --- | --- |
| Supabase | Login GitHub, 2FA concluido pelo usuario, OAuth/PKCE, initialize e tools/list | 29 ferramentas |
| Canva | E-mail confirmado na pagina de consentimento; Equipe de Sky selecionada; OAuth, initialize e tools/list | 49 ferramentas |
| Notion | E-mail confirmado no menu da conta; workspace Fagulha Software, consentimento, OAuth, initialize e tools/list | 49 ferramentas |
| Figma | Descoberta OAuth valida; registro DCR do cliente Fagulha retorna HTTP 403 | Bloqueado antes do login |
| GitHub remoto | Sem credencial retorna HTTP 401; OAuth sem cliente registrado e recusado | Nao autenticado; exige aplicativo OAuth ou token |
| Gmail | Initialize responde sem credencial; OAuth sem cliente registrado e recusado | Handshake publico nao comprova login; exige cliente OAuth |
| Google Drive | Mesmo teste de Gmail no endpoint do Drive | Exige cliente OAuth |
| Google Calendar | Mesmo teste de Gmail no endpoint do Calendar | Exige cliente OAuth |
| Microsoft 365 Mail | Catalogo contem placeholder de tenant e impede conexao | Nao testavel sem endpoint real e configuracao do tenant |
| Microsoft 365 Calendar | Mesmo requisito de tenant do Mail | Nao testavel sem endpoint real e configuracao do tenant |

O harness utilizou os mesmos modulos OAuthMcp e conectarMcp da extensao e
o Chrome conectado do usuario. Isso valida autenticacao e descoberta das
ferramentas, mas nao e uma verificacao visual da sala instalada nem comprova
execucao de cada ferramenta. Nenhuma ferramenta de escrita ou banco de dados
foi executada. Servidores personalizados nao tem um endpoint definido para
teste. Recursos nativos de agentes tem autenticacao propria e nao foram
tratados como conexoes MCP compartilhadas.

## Correcao

A tentativa exibida pelo usuario no Supabase usava um cliente nao reconhecido.
Um registro novo chegou ao consentimento e completou OAuth. Na versao 0.4.8,
tentativas interativas sem tokens salvos renovam o registro dinamico; clientes
explicitamente configurados pelo usuario sao preservados. Tokens existentes
continuam seguindo o fluxo de renovacao do SDK.

## Requisitos dos fornecedores

- [Supabase: login OAuth no navegador](https://supabase.com/docs/guides/ai-tools/mcp)
- [Figma: somente clientes aprovados e lista de espera](https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/)
- [GitHub remoto: configuracao de OAuth pelo host](https://github.com/github/github-mcp-server/blob/main/docs/host-integration.md)
- [GitHub local: binario oficial oferece login proprio](https://github.com/github/github-mcp-server/blob/main/docs/oauth-login.md) — alternativa ainda nao implementada no catalogo compartilhado.
- [Google Workspace: configuracao de aplicativo OAuth](https://developers.google.com/workspace/guides/configure-mcp-servers)
- [Microsoft Work IQ: licenca e administracao do tenant](https://learn.microsoft.com/microsoft-agent-365/tooling-servers-overview)
