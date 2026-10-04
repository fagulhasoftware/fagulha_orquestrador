# Orquestrador Fagulha para VS Code - Arquitetura

Nome publico: **Orquestrador Fagulha** ("Orquestra" ja existe na loja do VS Code; renomeado em 2026-10-04).
Produto da Fagulha. Nomenclatura oficial:

| Item | Valor |
|---|---|
| Nome exibido | Orquestrador Fagulha |
| Identificador da extensao | `FagulhaSoftware.orquestrador-fagulha` |
| Comandos, paineis e configuracoes | `fagulha.*` |
| Canal da sala | `#fagulha_orquestrador` |
| Servidor MCP dos agentes | `fagulha_orquestrador` (ferramentas `mcp__fagulha_orquestrador__*`) |

A pasta local de dados `~/.orquestra` e a sala de terminal mantem o nome antigo (internos).

Versao 0.1 - 2026-10-04 - autor: Claude (arquiteto). Mudancas neste documento e em
`src/shared/protocolo.ts` exigem acordo entre Claude e Codex, registrado na missao.

## 1. Visao

Extensao do VS Code que transforma a sala #fagulha_orquestrador (hoje `~/.orquestra/sala.mjs`, terminal) em um
painel de chat nativo. Cada janela do VS Code tem **uma sala**. Todos os agentes instalados (CLIs ou
APIs) participam da mesma sala, com papel, modo de permissao e estado de login proprios. Os agentes
compartilham a conversa, as acoes (leituras, escritas, comandos, navegacao) e os anexos.

Principios inegociaveis:

1. **Tudo local.** Conversa, acoes, aprovacoes e anexos ficam em SQLite em `~/.orquestra/dados/`.
   Nada e publicado, enviado ou sincronizado sem pedido explicito do usuario.
2. **Dono no controle.** Toda acao de agente passa pelo Portao de Permissoes (secao 5).
   Mesmo no nivel Total, o agente informa e pede aprovacao para acoes criticas.
3. **Segredos so no SecretStorage do VS Code.** Nunca em SQLite, log, prompt ou arquivo.
4. **Extensivel como o Kilo.** Novos agentes entram por manifesto ou por outra extensao (secao 4).
5. **Limites de processamento.** Arquivos pesados (planilhas e derivados) nunca sao lidos integralmente.

## 2. Componentes (extension host)

```
src/
  extension.ts            ativacao, comandos, registro do WebviewView, API publica (Codex)
  shared/protocolo.ts     contrato webview <-> host (Claude, alteracao conjunta)
  core/sala.ts            sala por janela: historico, fila, mencoes, passagem da palavra, /parar (Codex)
  core/contexto.ts        montagem do prompt de cada agente (porta de contexto() do sala.mjs) (Codex)
  providers/              Provedor + implementacoes CLI e API, carregador de manifestos (Codex)
  permissions/            Portao de Permissoes, matriz nivel x categoria, auditoria (Codex)
  mcp/                    servidor MCP "fagulha_orquestrador" (stdio) + ponte HTTP local com o host (Codex)
  storage/                SQLite (sql.js/WASM), migrations, repositorios (Codex)
  attachments/            pipeline de anexos com limites, em worker com timeout (Codex)
  context-import/         importar conversas do Claude Code, Codex e da sala de terminal (Codex)
  browser/                ler pagina (fetch + extracao), abrir no navegador externo (Codex)
  voice/                  gravacao ffmpeg + transcricao whisper.cpp local (Codex, fase 1b)
  webview/                interface de chat (Claude)
media/                    icones e CSS (Claude)
```

## 3. Sala

- Uma sala por janela, chaveada pela pasta do workspace (sem workspace: sala "avulsa").
- Mensagens do usuario com `@agente` acionam; `@todos` aciona todos os habilitados; sem mencao, so registra.
- Agente que menciona outro passa a palavra; limite de passagens automaticas configuravel (padrao 6).
- Fila serial por sala (um agente por vez), com `parar` que encerra a arvore de processos.
- Cada agente recebe: papel, topico, participantes, regras do projeto (AGENTS.md, CLAUDE.md,
  orquestra/MEMORIA.md quando existirem), anexos e contextos ativos, e a conversa desde a ultima vez
  que falou (mesma logica de `contexto()` do sala.mjs).
- "Pensamentos compartilhados": falas, acoes (`usa Read`, `roda git status`, `altera x.ts`) e
  resultados de ferramentas MCP entram no historico e chegam aos demais agentes.
- Sessoes dos CLIs sao retomadas por sala e agente; mudar o modo de permissao abre sessao nova.

## 4. Provedores (agentes)

Interface (detalhe em `src/providers/tipos.ts`, definido pelo Codex a partir de `protocolo.ts`):

```
detectar()      -> instalado? versao? caminho
estadoLogin()   -> conectado | desconectado | chave_configurada | desconhecido
login()         -> abre o login oficial (terminal integrado: `claude` /login, `codex login`, `gemini`)
                   ou pede a chave (SecretStorage) para provedores de API
executar(pedido, eventos, sinalCancelamento)
```

Embutidos na fase 1: Claude Code CLI, Codex CLI, Gemini CLI (apelido Antigravity), Ollama (local),
OpenAI-compativel (base URL + chave), Anthropic API (chave), Gemini API (chave).

Extensibilidade:

1. **Manifesto** `~/.orquestra/provedores/<id>/orquestra-provedor.json` (tipos `cli-generico` e
   `openai-compativel`): comando, argumentos com marcadores (`{prompt}`, `{sessao}`, `{modo}`),
   formato de saida (`texto` ou `jsonl` com mapeamento de campos), suporte a imagem, comando de login.
2. **Outras extensoes**: `activate()` exporta `{ registrarProvedor(prov) }`; uma extensao terceira
   declara `extensionDependencies: ["FagulhaSoftware.orquestrador-fagulha"]` e registra seu agente.
3. Tela "Agentes" na interface: instalar (manifesto ou link para extensao), habilitar/desabilitar,
   login, papel, modo de permissao.

## 5. Permissoes

### 5.1 Nivel global (escolhido no assistente de instalacao, alteravel nas configuracoes)

| Nivel | Comportamento |
|---|---|
| `manual` | Toda acao de agente (leitura, escrita, comando, rede) pede aprovacao. CLIs rodam no modo nativo somente leitura; escrita e comando so pelas ferramentas MCP do Orquestrador Fagulha. |
| `parcial` | Leitura e escrita **dentro do workspace** seguem o modo do agente sem perguntar. Pedem aprovacao: qualquer acesso **fora do workspace** (resto da maquina), comandos de shell, navegador externo e sistemas externos. |
| `total` | Executa sem bloquear e **sempre informa** na sala (cartao de acao). Continuam pedindo aprovacao: acoes destrutivas, publicacao/escrita externa (push, deploy, envio), credenciais. Ativar exige ler o aviso de riscos e digitar a confirmacao. |

### 5.2 Modo por agente e modelo hibrido (decisao do produto, 2026-10-04)

`leitura_escrita` (padrao) | `leitura` | `escrita` (escreve onde for pedido; nao explora o projeto,
recebe so o contexto anexado).

Os CLIs sempre usam o **login ja existente** do usuario (sem `--bare`, sem perfil isolado que exija
novo login).

- Nivel `manual`: isolamento estrito. Ferramentas nativas desligadas; todo efeito passa pelas
ferramentas MCP do Orquestrador Fagulha e pelo Portao.
- Niveis `parcial` e `total`: o CLI roda **na pasta do projeto** com escrita nativa dentro do
  workspace, conforme o modo. Shell e acessos fora do workspace passam pelo Portao.

| Agente | leitura | leitura_escrita | escrita |
|---|---|---|---|
| Claude | `--permission-mode plan` | `--permission-mode acceptEdits` + `--permission-prompt-tool mcp__fagulha_orquestrador__aprovar` | idem + `--disallowedTools Read Glob Grep` |
| Codex | `--sandbox read-only` | `--sandbox workspace-write` (sem rede) | idem (restricao de leitura so por instrucao) |
| Gemini | `--approval-mode plan` | `--approval-mode auto_edit` | idem (restricao de leitura so por instrucao) |

Limite conhecido: no nivel `parcial`, comandos do Codex rodam no sandbox do proprio Codex
(somente o workspace, sem rede) e nao passam pelo Portao. Com `.env` presente, o Gemini roda com
aviso na sala, nao bloqueado; o Orquestrador Fagulha nunca le arquivos `.env`.

### 5.3 Categorias de acao

`leitura_workspace`, `escrita_workspace`, `leitura_maquina`, `escrita_maquina`, `comando`,
`rede_leitura`, `navegador`, `externo` (repositorio remoto, VM, site com login), `publicacao`,
`credencial`, `destrutiva`. A matriz nivel x categoria vive em `src/permissions/matriz.ts` e tem teste
para cada celula. Toda decisao (aprovada, negada, automatica) vai para a tabela `auditoria`.

## 6. Servidor MCP "fagulha_orquestrador"

- Binario `dist/mcp-servidor.js`, iniciado pelos CLIs via configuracao gerada por sessao
  (Claude: `--mcp-config <arquivo> --strict-mcp-config`; Codex: `-c mcp_servers.fagulha_orquestrador...`;
  Gemini: settings da sessao).
- Fala com o host por HTTP em `127.0.0.1:<porta aleatoria>` com token por sessao (bearer) passado por
  variavel de ambiente. O host recusa conexoes sem token.
- Ferramentas: `aprovar` (permission prompt do Claude), `sala_publicar`, `sala_ler`, `anexos_listar`,
  `anexo_ler`, `arquivo_ler`, `arquivo_escrever`, `comando_executar`, `navegador_ler`,
  `navegador_abrir`. Todas passam pelo Portao.

## 7. Armazenamento local

SQLite via sql.js (WASM, sem compilacao nativa), arquivo `~/.orquestra/dados/orquestra.sqlite`,
gravacao atomica (arquivo temporario + rename). Tabelas: `salas`, `mensagens`, `acoes`,
`aprovacoes`, `auditoria`, `anexos` (metadados; conteudo em `~/.orquestra/dados/anexos/<sha256>`),
`provedores`, `sessoes_provedor`, `contextos`. Migrations versionadas. Exportar conversa (markdown)
so por comando explicito.

## 8. Anexos e limites

| Tipo | Extensoes | Limite de arquivo | Processamento |
|---|---|---|---|
| Texto/codigo | txt, md, json, yaml, xml, html, log, codigo, csv <= 512 KB | 2 MB | integral ate 512 KB; acima, primeiros 512 KB + aviso |
| Imagem | png, jpg, jpeg, webp, gif | 10 MB | passada ao agente que suporta imagem; os demais recebem so a descricao |
| PDF | pdf | 20 MB | texto das primeiras 50 paginas |
| Word | docx | 20 MB | texto (mammoth) |
| **Planilhas** | xlsx, xlsm, csv > 512 KB, tsv | **5 MB** | **nunca integral**: ate 5 abas, cabecalho + 50 linhas por aba, contagem de linhas estimada; leitura em streaming; acima de 5 MB o anexo e recusado com explicacao |
| Planilhas legadas | xls, xlsb, ods | - | **recusadas**: nao ha leitura em streaming segura; o usuario converte para xlsx ou csv |
| Outros | qualquer | 2 MB | so metadados (nome, tamanho, tipo) |

Todo parser roda em worker thread com timeout de 10 s e teto de memoria. Os limites ficam nas
configuracoes (`fagulha.anexos.*`) com estes valores como padrao e maximos rigidos no codigo.

## 9. Contexto de outros chats

Importar como "contexto" (chip removivel no chat): conversas do Claude Code
(`~/.claude/projects/**.jsonl`), do Codex (`~/.codex/sessions/**.jsonl`), da sala de terminal
(`~/.orquestra/sala/logs/**`) e de outras salas da extensao. Escolha por QuickPick com busca; o
conteudo e resumido para um orcamento de tamanho (padrao 12 000 caracteres, ultimas mensagens).

## 10. Navegador, voz e sistemas externos

- Fase 1: `navegador_ler` (fetch HTTP(S), extracao de texto, limite 1 MB, aprovacao conforme nivel)
  e `navegador_abrir` (navegador externo do sistema).
- Fase 1b, voz: gravacao com ffmpeg (DirectShow) e transcricao com whisper.cpp e modelo local.
  Nenhum audio sai da maquina. O assistente detecta ffmpeg/whisper e orienta a instalacao, que so
  acontece com confirmacao do usuario. O webview nao tem acesso ao microfone; a gravacao e no host.
- Fase 2: navegador controlado via Chrome DevTools Protocol (Chrome do usuario aberto com porta de
  depuracao), repositorios remotos, VMs (ssh) e sites com login, sempre na categoria `externo`.

## 11. Instalacao e configuracao

1. `npm run package` gera `orquestrador-fagulha-<versao>.vsix`; `code --install-extension <vsix>`.
2. Assistente da primeira execucao: detecta CLIs e login de cada um, escolhe agentes e papeis,
   escolhe o nivel de permissao (aviso de riscos para Total), mostra onde os dados ficam.
3. Configuracoes em `fagulha.*` (settings do VS Code) e tela propria no painel.

## 12. Divisao do trabalho e validacao

| Dono | Arquivos |
|---|---|
| Claude | `docs/**`, `src/shared/protocolo.ts` (conjunto), `src/webview/**`, `media/**` |
| Codex | `package.json`, `tsconfig*.json`, `esbuild.mjs`, `src/extension.ts`, `src/core/**`, `src/providers/**`, `src/permissions/**`, `src/mcp/**`, `src/storage/**`, `src/attachments/**`, `src/context-import/**`, `src/browser/**`, `src/voice/**`, `test/**` |

Ninguem altera arquivo do outro; divergencias vao para a secao "Objecoes" do proprio arquivo da missao.
Validacao conjunta: Codex revisa `src/webview/**`, Claude revisa o restante; testes automatizados
(`npm test`) cobrindo matriz de permissoes, limites de anexos, roteamento de mencoes e contrato;
depois roteiro manual do usuario no VS Code.

## 13. Fases

- **F1**: sala, provedores embutidos, permissoes + MCP, SQLite, anexos com limites, contexto de
  outros chats, navegador_ler/abrir, interface completa, assistente, pacote .vsix.
- **F1b**: voz local.
- **F2**: navegador via CDP, sistemas externos (repositorios, VMs, sites), marketplace de manifestos.
