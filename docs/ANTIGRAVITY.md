# Antigravity na sala Fagulha

Provedor independente `antigravity`, mencoes `@antigravity`, `@ag` e `@agy`.
Gemini continua disponivel como `@gemini`; nao encaminha mais os apelidos Antigravity.

O executavel `agy` e detectado no PATH e em `~/.gemini/bin`. Pode ser definido por
`fagulha.provedores.antigravity.comando`. A autenticacao e a conta oficial do
Antigravity, compartilhada com sua extensao; a sala nao le arquivos de credenciais.
Sem uma API de status de login, o painel informa estado desconhecido ate a execucao.
Uma resposta bem-sucedida confirma a conta autenticada. O servidor MCP da Fagulha e
registrado pelo comando oficial `agy mcp add`; nao persiste URL/token de capacidade
nesse registro global. Fora da execucao da sala, a ponte fica indisponivel.

## Permissoes

Esta primeira integracao executa **Total + leitura e escrita**, com permissao nativa
automatica do CLI. Manual, Parcial, somente leitura e somente escrita sao recusados
antes de iniciar, pois o isolamento dessas modalidades ainda nao foi comprovado.
Isso e uma limitacao explicita, nao uma equivalencia completa com Claude/Codex.

Ferramentas nativas e MCPs herdados do Antigravity podem agir fora do Portao.
Operacoes pela ponte Fagulha mantem identidade do participante, capacidade revogavel,
validacao de argumentos, auditoria e permissoes da sala.

## Navegador

Ferramentas compartilhadas com os participantes: `navegador_controlar`,
`navegador_estado`, `navegador_preencher`, `navegador_clicar`, `navegador_capturar`,
`navegador_fechar`. Chrome/Edge local, perfil temporario e headless; nao utiliza
abas, cookies ou senhas do perfil pessoal. Nao baixa navegador.

Cliques passam por confirmacao individual: um clique pode enviar, publicar ou
comprar. Campos de formulario nunca sao registrados nos cartoes; nao enviar
segredos. Texto da pagina e dado externo nao confiavel. Captura retorna PNG via MCP.

## Validacao

`npm test`, `npm run check:webview`, `npm run package` e `npm run verify:antigravity`.
O ultimo usa a conta autenticada e uma pagina sintetica localhost: exige chamadas
MCP reais e imagem retornada, nao aceita uma afirmacao textual do modelo como prova.
Nao publica Marketplace nem GitHub.

Validacao local desta entrega: Antigravity 1.3.3 autenticado chamou as tres ferramentas
de navegacao/estado/captura em pagina sintetica. Chrome real tambem validou input e
clique. O plugin opcional `googlecloudtools.datacloud_telemetry` foi desativado pelo
CLI oficial: seu hook PreToolUse tinha erro de caminho com aspas no Windows e impedia
as chamadas. Pode ser reativado com `agy plugin enable googlecloudtools.datacloud_telemetry`
depois de corrigido. Nenhuma chave ou arquivo de autenticacao foi lido.

Referencias oficiais: https://www.antigravity.google/docs/cli/headless/
e https://www.antigravity.google/docs/mcp.
