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

Versao 0.1 - 2026-10. Mudancas neste documento e em `src/shared/protocolo.ts` devem ser propostas em
*issue* ou *pull request* e aprovadas por um mantenedor (ver CONTRIBUTING.md).

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
  extension.ts            ativacao, comandos, registro do WebviewView, API publica
  shared/protocolo.ts     contrato webview <-> host (Claude, alteracao conjunta)
  core/sala.ts            sala por janela: historico, fila, mencoes, passagem da palavra, /parar
  core/contexto.ts        montagem do prompt de cada agente (porta de contexto() do sala.mjs)
  providers/              Provedor + implementacoes CLI e API, carregador de manifestos
  permissions/            Portao de Permissoes, matriz nivel x categoria, auditoria
  mcp/                    servidor MCP "fagulha_orquestrador" (stdio) + ponte HTTP local com o host
  storage/                SQLite (sql.js/WASM), migrations, repositorios
  attachments/            pipeline de anexos com limites, em worker com timeout
  context-import/         importar conversas do Claude Code, Codex e da sala de terminal
  browser/                ler pagina (fetch + extracao), abrir no navegador externo
  voice/                  gravacao ffmpeg + transcricao whisper.cpp local (Codex, fase 1b)
  webview/                interface de chat
media/                    icones e CSS
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

### 3.1 Chats e memoria persistente (versao 0.2.1)

- **Chat** e a unidade de conversa persistente (tabela `chats`): id, titulo, projeto (pasta ou nulo),
  criado/atualizado, fixado. Mensagens, acoes, anexos, aprovacoes, contextos e sessoes dos CLIs pertencem
  ao chat. A sala continua sendo a janela/pasta; ela aponta para o chat ativo.
- **Abertura:** a janela reabre o ultimo chat usado na sua pasta (`ultimo_chat` por sala); sem pasta, o
  ultimo chat sem projeto; sem nenhum, cria um chat novo. Fechar e reabrir o VS Code restaura o chat e
  as sessoes dos agentes.
- **Novo chat:** cria um chat vazio na pasta da janela; as sessoes dos CLIs sao chaveadas por chat, entao
  os agentes comecam do zero sem apagar o chat anterior.
- **Menu Chats:** lista todos os chats (fixados, deste projeto, outros projetos, sem projeto); busca
  local em titulos e no texto das mensagens (falas e do usuario, nunca segredos mascarados); renomear,
  fixar, exportar em Markdown e excluir (apaga mensagens, acoes, anexos e sessoes do chat). Abrir um chat
  de outro projeto mostra o historico; os agentes trabalham na pasta da janela atual.
- **Titulo automatico:** primeira mensagem do usuario, sem mencoes, ate 60 caracteres; editavel.
- **Memoria persistente** (tabela `memorias`): fatos curtos (ate 500 caracteres), escopo `global` ou
  `projeto`, ativos ou desativados. As memorias ativas do escopo (global + projeto da janela) entram no
  contexto de cada agente numa secao "Memoria do usuario", com teto de 4 000 caracteres (mais recentes
  primeiro). Origem: usuario (menu ou `/lembrar`, `/lembrar-global`) ou agente pela ferramenta MCP
  `memoria_propor`, que gera um pedido de aprovacao categoria `memoria` e so grava se o usuario aprovar.
  Texto que pareca segredo (chaves, tokens, senhas) e recusado.
- **Migracao:** cada sala existente vira um chat (titulo gerado da primeira mensagem ou "Conversa de
  <data>"), preservando mensagens, acoes, anexos e sessoes.

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
- Voz (versao 0.2.0): ver secao 10.1.
- Fase 2: navegador controlado via Chrome DevTools Protocol (Chrome do usuario aberto com porta de
  depuracao), repositorios remotos, VMs (ssh) e sites com login, sempre na categoria `externo`.

### 10.1 Chat por voz: falar e ouvir (versao 0.2.0)

O webview nao tem acesso ao microfone; gravacao, transcricao e leitura acontecem no extension host.

**Falar**

| Etapa | Implementacao |
|---|---|
| Gravacao | ffmpeg, 16 kHz mono WAV em arquivo temporario. Windows: `-f dshow -i audio="<dispositivo>"` (lista com `-list_devices true`); macOS: `-f avfoundation -i ":<indice>"`; Linux: `-f pulse -i default` (alsa como alternativa). Limite de 120 s por gravacao; o host emite `segundosGravados` a cada segundo. |
| Transcricao | whisper.cpp (`whisper-cli`) com o modelo escolhido (padrao `small`), idioma configuravel (padrao `pt`), saida em texto. Timeout proporcional a duracao. |
| Resultado | `envioAutomatico` ligado: a transcricao e enviada como mensagem do usuario (com mencoes, se ditas, ex.: "arroba claude"). Desligado: vai para a caixa de texto. |
| Limpeza | O WAV e os arquivos auxiliares sao apagados apos a transcricao, no descarte e na desativacao da extensao. Audio nunca vai para o SQLite. |

**Instalacao dos componentes (assistente com consentimento)**

- Pasta propria: `~/.orquestra/voz/{bin,modelos}`. Sem administrador, sem alterar o PATH.
- Antes de baixar, a interface mostra cada componente, a origem e o tamanho; o clique em
  "Baixar e instalar" e o consentimento. O host so baixa os componentes recebidos em `vozInstalar`.
- Windows: ffmpeg (build oficial em GitHub Releases) e whisper.cpp (binario oficial do projeto em GitHub
  Releases), versoes fixadas. macOS e Linux: ffmpeg e whisper.cpp ficam como `manual`, com o comando
  sugerido (`brew install ffmpeg whisper-cpp`; `sudo apt install ffmpeg` e instrucoes do whisper.cpp).
  Componentes ja presentes no PATH sao reaproveitados.
- Modelos: arquivos `ggml-<modelo>.bin` do repositorio oficial do whisper.cpp no Hugging Face.
- Todo download: somente HTTPS para hosts permitidos (github.com, objects.githubusercontent.com,
  huggingface.co e seus CDNs), SHA-256 fixado no codigo e conferido antes de usar, download em arquivo
  `.parcial` com retomada/cancelamento, extracao limitada ao destino (sem caminhos `..`).

**Ouvir**

- Voz nativa do sistema: Windows via SAPI (`System.Speech` em PowerShell, sem janela), macOS via `say`,
  Linux via `spd-say` ou `espeak-ng`. Sem download.
- Le somente falas de agentes: remove markdown, troca blocos de codigo por "trecho de codigo omitido",
  limita a ~1500 caracteres por fala. Leitura automatica opcional e botao "ouvir" por mensagem.
- Iniciar uma gravacao interrompe a leitura em andamento (evita o microfone captar a propria voz).
- O texto e passado ao processo de fala por stdin ou arquivo temporario, nunca como argumento de linha
  de comando (evita injecao e limite de tamanho).

## 11. Instalacao e configuracao

1. `npm run package` gera `orquestrador-fagulha-<versao>.vsix`; `code --install-extension <vsix>`.
2. Assistente da primeira execucao: detecta CLIs e login de cada um, escolhe agentes e papeis,
   escolhe o nivel de permissao (aviso de riscos para Total), mostra onde os dados ficam.
3. Configuracoes em `fagulha.*` (settings do VS Code) e tela propria no painel.

## 12. Areas do codigo e validacao

| Area | Arquivos |
|---|---|
| Contrato interface <-> extensao | `src/shared/protocolo.ts` |
| Interface de chat | `src/webview/**`, `media/**` |
| Extensao (host) | `src/extension.ts`, `src/core/**`, `src/providers/**`, `src/permissions/**`, `src/mcp/**`, `src/storage/**`, `src/attachments/**`, `src/context-import/**`, `src/browser/**`, `src/voice/**` |
| Build e empacotamento | `package.json`, `tsconfig*.json`, `esbuild.mjs`, `scripts/**` |
| Testes | `test/**` |

A interface e a extensao so se comunicam pelo contrato. Mudancas que alteram o formato de mensagens
existentes aumentam `VERSAO_PROTOCOLO`.

Validacao de toda mudanca: `npm test` (matriz de permissoes, limites de anexos, roteamento de mencoes,
login, MCP, armazenamento e contrato), `npm run check:webview`, `npm run package` com o verificador de
privacidade e teste manual no VS Code (F5).

## 13. Fases

- **F1**: sala, provedores embutidos, permissoes + MCP, SQLite, anexos com limites, contexto de
  outros chats, navegador_ler/abrir, interface completa, assistente, pacote .vsix.
- **F1b**: voz local.
- **F2**: navegador via CDP, sistemas externos (repositorios, VMs, sites), marketplace de manifestos.
