# Orquestrador Fagulha

## Specialists and native resources (0.4.2)

Use `@` for room participants, `#` for specialist skills/apps/MCP integrations and `/` for room commands.
Examples: `@codex #canva prepare a design`, `@claude #code-review review the diff`.
Full mode preserves native provider features and existing connections. The room lists actual Codex app metadata separately from shared MCP connections; an app available to Codex is not automatically authenticated for another provider.
Skills can be discovered/imported and read through the shared `skill_ler` tool. Remote MCP OAuth supports browser sign-in, PKCE and SecretStorage. Some vendors require a registered OAuth client.
`/pausar` interrupts a turn; `/continuar` resumes the agent using available context/session, rather than freezing model reasoning. `/skills`, `/integracoes`, `/agentes` and `/ajuda` open room functions.

**English** · [Português (Brasil)](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/README.pt-BR.md) · [Español](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/README.es.md) · [Deutsch](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/README.de.md)

A private chat room inside VS Code where your AI agents — Claude Code, Codex, Gemini CLI, Ollama and
API-key models — talk to each other and to you, share what they read and write, and only act within the
permissions you set.

Everything happens **on your computer**. There is no Fagulha server, no Fagulha account and no sync.

## Features

- **One room per VS Code window**: mention `@claude`, `@codex`, `@gemini` or `@todos` (everyone) to call
  the agents. An agent can hand the turn to another by mentioning it.
- **Your agents, your logins**: sign in with your Claude or ChatGPT account in the browser, or use API keys
  (OpenAI, Anthropic, Google AI Studio, OpenAI-compatible servers). Keys are tested with the provider before
  being stored in VS Code's secure storage.
- **Three permission levels**, chosen on first run:
  - **Manual** — you approve 100% of the agents' actions;
  - **Partial** — free inside the project folder, approval for everything else;
  - **Full** — complete access; known irreversible external commands ask for confirmation.
    Codex gets network, web search and your inherited MCP servers; commands run through the room.
- **Per-agent modes**: read and write, read-only or write-only, plus a free-form role
  (e.g. "architect", "reviewer").
- **Attachments**: text, code, Markdown, images, PDF and Word. Images reach the agents as images.
  Spreadsheets are never read in full: Orquestrador sends only the header and a sample of rows, with a size
  limit.
- **Agent stages and guided questions**: follow what each agent is doing and get questions with suggested
  answers when it needs a decision; the room pauses until you answer.
- **Voice chat**: talk to the room through your microphone and listen to the agents' answers.
  Transcription (whisper.cpp) and speech (your system voice) run on your computer; the recording is deleted
  after transcription. Voice components are downloaded only with your permission.
- **Chats and persistent memory**: every conversation stays in the **Chats** menu (searchable) and comes
  back when you reopen VS Code; **New chat** starts fresh without losing anything. **Memory** keeps
  active preferences and decisions selected for the current project within a context budget; proposals are saved automatically on Full
  and ask for your approval on the other levels.
- **Context from other chats**: import the most recent text from previous Claude Code, Codex or room conversations.
  Older decisions are not automatically preserved. See [decision handoffs and their limits](docs/CONTEXT_HANDOFF.md).
- **Extensible**: new agents through manifests or other extensions (`FagulhaSoftware.orquestrador-fagulha`).

## Requirements

- VS Code 1.95 or later.
- At least one agent:
  - [Claude Code](https://code.claude.com) (CLI or VS Code extension), with a Claude subscription account (API keys belong to the separate Anthropic participant);
  - [Codex](https://developers.openai.com/codex) (CLI or VS Code extension), with a ChatGPT account (API keys belong to the separate OpenAI participant);
  - [Gemini CLI](https://geminicli.com), with a Google AI Studio key;
  - Mistral Vibe / Mistral Code Enterprise via ACP, with independent native browser profiles; Mistral API uses a separate key participant;
  - [Ollama](https://ollama.com), running locally;
  - or an API key from a compatible provider.

Orquestrador Fagulha does not include or resell model access: each user brings their own accounts and pays
the providers directly, when there is a charge.

## Installation

- **From the VS Code Marketplace:** open Extensions (`Ctrl+Shift+X`), search for **Orquestrador Fagulha**
  and click **Install**.
- **From a `.vsix` file:** download the package from
  [Releases](https://github.com/fagulhasoftware/fagulha_orquestrador/releases) and use
  *Extensions → `...` → Install from VSIX*, or `code --install-extension orquestrador-fagulha-<version>.vsix`.

Every installation is independent: Orquestrador starts clean, with no conversations, accounts or settings from
anyone else.

## Getting started

1. Open **Orquestrador Fagulha** in the Activity Bar.
2. Follow the setup: choose your agents, sign in and pick a permission level.
3. Write in the room mentioning an agent, for example: `@claude explain the structure of this project`.

## Commands and shortcuts

Every mention, chat command, keyboard shortcut, button and setting — and when to use each one — is listed in
[docs/COMMANDS.md](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/docs/COMMANDS.md). The essentials: `@agent` calls an agent, `@todos` calls everyone, `/stop`
stops the current agent, `/remember <text>` saves a memory, `Ctrl+Alt+V` starts voice input.

## Privacy

- Conversations, actions, approvals and attachments are stored only in `~/.orquestra/dados`, on your computer.
- Credentials live in VS Code's SecretStorage and are never written to files, logs or the local database.
- No telemetry. The only network connections are the ones you or your agents make to the providers you
  configured yourself.

Details in [PRIVACY.md](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/PRIVACY.md).

## Known limitations

- Voice: components install automatically on Windows; on macOS and Linux the setup shows the command to
  install ffmpeg and whisper.cpp.
- `.xls`, `.xlsb` and `.ods` spreadsheets are rejected; convert them to `.xlsx` or `.csv`.
- The interface is being translated; some messages may still appear in Portuguese.

## Development

Prerequisites: [Node.js](https://nodejs.org) 20 or later, Git and VS Code 1.95 or later.

```bash
git clone https://github.com/fagulhasoftware/fagulha_orquestrador.git
cd fagulha_orquestrador
npm install
npm run build        # builds the extension, the MCP server and the UI into dist/
npm test             # automated tests (no real network, no real accounts)
```

To try it in VS Code, open the project folder and press **F5**: a new "Extension Development Host" window
opens with the extension loaded from source.

Other commands:

| Command | Purpose |
|---|---|
| `npm run check:webview` | Strict type check of the whole project |
| `npm run format` | Formats the code with Prettier |
| `npm run package` | Builds the `.vsix` and runs the package privacy check |
| `npm run smoke:clis` | Detects installed CLIs and prints the generated arguments, without calling models |

The architecture is described in [docs/ARQUITETURA.md](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/docs/ARQUITETURA.md) (Portuguese).

## Contributing

Contributions are welcome: fixes, new agents, UI improvements, documentation and translations.
Please read the [contributing guide](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/CONTRIBUTING.md) and the
[code of conduct](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/CODE_OF_CONDUCT.md) before opening an issue or a pull request.

## Security

Do not report vulnerabilities in public issues. Follow the [security policy](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/SECURITY.md).

## Authors

A **Fagulha Software** product, built with Codex (OpenAI) and Claude (Anthropic).
Acknowledged contribution: Fagulha Software 50%, Codex 30%, Claude 20%. Details in
[AUTHORS.md](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/AUTHORS.md).

## License

[MIT](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/LICENSE) © Fagulha. Claude, Codex, ChatGPT, Gemini and Ollama are trademarks of their
respective owners; Orquestrador Fagulha is compatible with these tools, with no official affiliation or endorsement.

## Historical: Codex on the Full level (0.3.0)

Codex gets complete file access in read-and-write mode, live web search, and keeps the MCP servers configured by
the user. Read-only mode keeps the read-only sandbox. The native shell is turned off: commands go through
`comando_executar`, with a timeout, an output limit and auditing. Manual and Partial keep the previous behavior.

On CLI 0.160.0, local verification confirmed web search and no native shell; `apply_patch` was not offered in that
scenario either. Use `arquivo_escrever` to edit files. Availability of native tools may vary with the CLI and the
model.

The approval gate asks for individual confirmation of known external commands for deletion, destruction, forced
push and destructive SQL with an explicit remote host. The classifier is a heuristic: scripts, aliases, implicit
remote connections and tools from inherited MCP servers may perform actions outside that classification. Direct
MCP calls and native edits do not go through the approval gate; guidance in the context is not a technical
barrier. Room tools still refuse known sensitive destinations. Stop is always available. This item covers Codex
access; neural voice and other features planned for 0.3.0 are not included.

## Model Picker e recuperacao de contexto (0.5.0)

Cada participante tem um seletor **Padrao / Auto** e **Atualizar modelos** na sala e no painel de agentes. A escolha fica salva por participante entre reinicios. Trocar durante uma execucao aplica a escolha apenas na proxima mensagem e abre uma sessao compativel; o turno atual conserva seu modelo. O modelo aplicado aparece junto do nome e em cada nova resposta, e os participantes recebem essa informacao no contexto. Quando o runtime nao informa o modelo efetivo do padrao, a interface mostra `Padrao / Auto`, sem adivinhar seu nome.

| Participante | Lista e aplicacao | Esforco |
| --- | --- | --- |
| Codex | Catalogo local `models_cache.json` do proprio Codex; alternativa configuravel. `--model`. O cache pode ficar desatualizado; nao garante acesso na conta. | Niveis anunciados por modelo; `-c model_reasoning_effort=...`. |
| Claude Code | Lista configuravel em settings; `--model`. Nao ha comando estavel de listagem utilizado por este adaptador. | Apenas niveis configurados por modelo; `--effort`. Runtime precisa suportar a flag. |
| Antigravity | `agy models` retorna IDs/nomes reais; `--model`. Lista configuravel se a consulta falhar. | A lista nativa nao declara niveis por modelo; controle oculto. Variantes com esforco no ID aparecem como modelos separados. `--effort` pode ser usado com niveis explicitamente configurados. |
| Mistral Vibe / Enterprise | Lista anunciada no ACP, `session/set_config_option`. Exige login, runtime compativel e Total/leitura e escrita. | Apenas opcoes anunciadas pelo runtime; revalidadas depois da troca do modelo. |
| Ollama | `/api/tags` e capacidades em `/api/show`; `model` em `/api/chat`. Nao baixa modelos automaticamente. | Oculto. |
| OpenAI / Mistral API / Anthropic / Gemini API | `/models`, com paginacao quando aplicavel, e parametro de modelo do endpoint. APIs compativeis sem metadados de capacidade exigem lista configurada para nao oferecer embeddings/audio como chat. | Oculto; nao inferido pelo nome. |
| DeepSeek e APIs compativeis | Mesmo mecanismo `/models` quando configurado como participante OpenAI-compativel ou manifesto API; lista configuravel se endpoint nao listar ou nao declarar capacidade de chat. | Oculto. Nao adiciona conta ou participante DeepSeek automaticamente. |
| CLI generica / extensao de terceiro | CLI generica exige `{modelo}` em `argumentos` do manifesto e lista configurada. Extensoes precisam implementar `listarModelos` e consumir `PedidoExecucao.modelo`. | Oculto sem contrato implementado. |

Use IDs obtidos do runtime/provedor. Exemplo **sintetico**, para substituir pelos IDs reais da sua conta:

```json
{
  "fagulha.provedores": {
    "claude": {
      "modelos": [
        { "id": "ID_REAL_DO_MODELO", "nome": "Nome na sua conta", "esforcos": ["low", "medium", "high"] }
      ]
    }
  },
  "fagulha.diagnosticoContexto": false
}
```

As listas configuradas tambem aceitam strings. Em APIs, `modelo` em settings e o padrao necessario para **Padrao / Auto**: APIs de chat normalmente exigem um ID e nao possuem padrao nativo. Se um modelo escolhido estiver indisponivel, sem permissao ou sem cota, a sala avisa e tenta o padrao uma vez. Se este tambem falhar, preserva o diagnostico e deixa o seletor disponivel para escolher outro modelo. O fallback nao troca autenticacao nem contorna limites de conta.

O Mistral conserva o acesso Total da 0.4.9. As preferencias nativas alteradas pelo ACP sao restauradas ao encerrar o turno, inclusive apos aborto; edicoes concorrentes externas sao preservadas com aviso. Historico reproduzido por ACP nao e mais tratado como resposta nova. Respostas de turnos cancelados ou com contexto superado sao descartadas; streaming e resposta final sao gravados uma unica vez. Cada turno tem ID e sequencia de contexto persistida.

A sala tenta reiniciar uma vez quando detecta resposta identica para perguntas diferentes, falha em pergunta-teste aritmetica simples explicita ou timeout. Persistindo o problema, marca **travado**. Use **Reiniciar contexto do agente** ou `/reiniciar-contexto @agente`. Isso preserva o historico da sala e o login. A deteccao nao comprova o contexto interno do modelo e nao julga respostas gerais semanticamente. Perguntas novas durante um turno descartam a resposta antiga; ferramentas ja executadas nao sao desfeitas.

Ative `fagulha.diagnosticoContexto` e abra **Saida ? Orquestrador Fagulha - Diagnostico** para ver agente, ID, sequencia, hash/tamanho do prompt, sessao nova/retomada, modelo e resultado. Prompts, respostas e credenciais nao sao registrados nesse canal. Consulte [o diagnostico e as evidencias](docs/DIAGNOSTICO_CONTEXTO_050.md).

## Sala e vozes (0.6.0)

Atividades de cada turno ficam em um grupo recolhido, com tempo e acao atual. Expanda o grupo e cada acao por clique ou teclado. Erros, aprovacoes e perguntas continuam visiveis. Use `fagulha.atividadesExpandidas: true` para iniciar expandido. O limite configuravel de passagens autonomas agora aceita ate 50; o padrao existente permanece 6.

Em Configuracoes > Voz, escolha sistema/webview ou nuvem, provedor, modelo, voz e velocidade; use **Testar voz**. Ha voz opcional por agente. Para nuvem, valide e salve sua chave: ela fica exclusivamente no SecretStorage do VS Code, com indicador mascarado. Nenhuma chave deve ir a settings.json. O login de Antigravity/Gemini ou ChatGPT nao substitui uma chave da API de voz. Nuvem envia texto ao provedor e pode gerar cobranca. Em falha, a sala avisa uma vez e usa a voz do sistema. Se o navegador bloquear reproducao automatica, clique em **Ativar audio**.

Provedores: Google Gemini (Interactions API), ElevenLabs (Text to Speech) e OpenAI (Realtime; Speech legado se anunciado pela conta). Modelos e vozes sao consultados nas APIs; vozes oficiais documentadas servem como catalogo onde nao ha listagem. Anthropic nao e provedor de TTS.

Para ouvir mensagens nao e necessario instalar Piper, player, driver ou pacote de audio. O webview toca MP3/WAV em memoria e usa `speechSynthesis` como alternativa local, conforme as vozes disponiveis no VS Code/SO. FFmpeg, Whisper.cpp e um modelo sao opcionais, apenas para ditado por microfone. Configuracoes antigas de Piper migram para sistema; ferramentas ja instaladas no computador nao sao apagadas.

Diagnostico: os comandos de salvar/remover chave nao eram tratados no host. A reproducao dependia de processos externos; foi substituida por audio no webview com confirmacao de termino, cancelamento e fallback. Falhas de captura e transcricao agora sao identificadas separadamente. Veja `docs/RELATORIO_060.md` para evidencias, limites e inventario.
