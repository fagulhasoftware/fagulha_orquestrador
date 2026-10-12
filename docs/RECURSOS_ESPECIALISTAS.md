# Recursos especialistas na Fagulha 0.4.2

A sala orquestra participantes; recursos nativos pertencem ao runtime e a conta de
cada agente. Uma skill e instrucao reutilizavel. Uma integracao MCP oferece ferramentas
e tem autenticacao propria. Um App do Codex nao vira automaticamente um App do Claude.

## Sintaxe

- `@codex`, `@claude`, `@antigravity`, `@nathan`, `@todos`: participantes.
- `#figma`, `#supabase`, `#canva`, `#lovable`, `#frontend-design`: especialistas.
- `#code-review`: workflow de revisao; prioriza skill instalada, ou orienta revisao
  de bugs, regressao e contratos. Nao cria outro participante nem um servico ficticio.
- `/pausar`, `/continuar`, `/parar`: controle da sala. Pausar interrompe o processo;
  continuar inicia outro turno do mesmo agente com o contexto/sessao disponivel.
  Nao congela nem restaura exatamente o estado interno do raciocinio do modelo.
- `/integracoes`, `/skills`, `/agentes`, `/configuracoes`, `/memorias`, `/novo`, `/ajuda`.

Exemplos: `@codex #canva prepare uma proposta visual`;
`@claude #code-review revise o diff sem alterar arquivos`;
`@antigravity #frontend-design revise a interface`.

## Recursos nativos

Em Total, a Fagulha nao desliga Apps, plugins, skills, comandos e configuracoes nativas
de Codex/Claude/Antigravity. MCPs herdados permanecem disponiveis. Ferramentas nativas
nao passam pelo Portao: use as ferramentas da sala para auditar e confirmar operacoes
irreversiveis externas. Niveis restritivos mantem as restricoes anteriores.

O catalogo Codex usa `app/list`/`app/list/updated` do app-server e exibe apenas
metadados de Apps acessiveis ou associados a plugins instalados. Nenhuma credencial
e exportada. A disponibilidade do catalogo nao comprova cada ferramenta ou tarefa.
Na verificacao local, Canva, Figma, Lovable, Notion e Supabase estavam acessiveis e
habilitados no runtime Codex. A sala nao migrou esses acessos para outro provedor.

## MCP compartilhado

Conexao por token/stdio e OAuth remoto estao ligados ao host. OAuth usa descoberta
MCP, PKCE, state, navegador e callback loopback
`http://127.0.0.1:43219/oauth/callback`. Tokens e dados do cliente ficam em
SecretStorage; nunca no SQLite ou no webview. Desconectar remove esses registros.

Figma e Notion permitem tentar autenticacao pelo navegador. Supabase/GitHub oferecem
token e OAuth; o fornecedor pode exigir um cliente registrado. Canva pelo gateway
usa o endpoint Developer Portal e exige Client ID/secret proprios com Canva MCP
habilitado. Microsoft 365 depende de tenant/endpoint proprio. Nenhum fornecedor foi
marcado como conectado sem listar ferramentas com sucesso.

Lovable aparece como recurso nativo quando o runtime o oferece. Nao foi inventado
um endpoint MCP publico para simular compartilhamento com todos os modelos.

## Skills

A sala descobre SKILL.md nas pastas de skills e caches de plugins locais dos agentes,
le nome/descricao e publica o catalogo. `#nome` carrega instrucoes para o agente
escolhido; `skill_ler` permite leitura sob demanda pelo MCP comum. Importacao de
pasta/ZIP/GitHub, visualizacao e ativacao estao implementadas.

Skills herdadas nao sao apagadas pela sala: podem ser desativadas aqui. Remover
fisicamente e permitido somente para skills importadas no diretorio gerenciado.
ZIPs rejeitam traversal, duplicatas e expansao acima dos limites. Referencias e
scripts da skill continuam no local de origem; nenhuma skill cria acesso OAuth.

## Evidencias e limites

Suite, typecheck, pacote e privacidade; OAuth sintetico com descoberta, DCR, PKCE,
state invalido/valido e tokens; importacao/leitura de skills; app-server Codex real;
interface em navegador com os tres namespaces. Autorizacao OAuth em contas reais
de Figma/Notion/Canva nao foi concluida nesta rodada: exige interacao do dono da conta.

O erro de modelo Anthropic da captura refere-se a um participante por API, nao a
um conector de suporte. Esse participante exige seu proprio modelo e chave; instalar
uma skill ou conectar Figma nao preenche esses parametros.
