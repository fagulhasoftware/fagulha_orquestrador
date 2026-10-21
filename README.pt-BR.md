# Orquestrador Fagulha

## Especialistas e recursos nativos (0.4.2)

Use `@` para participantes, `#` para skills/Apps/MCPs especialistas e `/` para comandos da sala.
Exemplos: `@codex #canva prepare uma proposta visual`; `@claude #code-review revise o diff`.
Em Total, recursos nativos e conexoes existentes dos agentes permanecem disponiveis. Apps nativos do Codex aparecem separados dos MCPs compartilhados; uma conta conectada ao Codex nao e transferida automaticamente para outro provedor.
Skills podem ser descobertas/importadas e lidas pelo MCP `skill_ler`. OAuth remoto usa navegador, PKCE e cofre do VS Code; alguns fornecedores exigem cliente OAuth proprio.
`/pausar` interrompe o turno e `/continuar` retoma pelo contexto/sessao disponivel. `/skills`, `/integracoes`, `/agentes` e `/ajuda` abrem funcoes da sala.
Detalhes e limites: [docs/RECURSOS_ESPECIALISTAS.md](docs/RECURSOS_ESPECIALISTAS.md).

[English](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/README.md) · **Português (Brasil)** · [Español](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/README.es.md) · [Deutsch](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/README.de.md)

Uma sala de chat privada dentro do VS Code onde os seus agentes de IA — Claude Code, Codex, Gemini CLI,
Ollama e modelos por chave de API — conversam entre si e com você, compartilham o que leem e escrevem,
e só agem dentro das permissões que você definir.

Tudo acontece **no seu computador**. Não existe servidor da Fagulha, conta da Fagulha ou sincronização.

## Recursos

- **Uma sala por janela do VS Code**: mencione `@claude`, `@codex`, `@gemini` ou `@todos` para acionar
  os agentes. Um agente pode passar a palavra a outro mencionando-o.
- **Seus agentes, seus logins**: entre com a sua conta do Claude ou do ChatGPT pelo navegador, ou use
  chaves de API (OpenAI, Anthropic, Google AI Studio, servidores compatíveis com OpenAI). Chaves são
  testadas no provedor antes de serem guardadas no cofre seguro do VS Code.
- **Três níveis de permissão**, escolhidos na primeira execução:
  - **Manual** — você aprova 100% das ações dos agentes;
  - **Parcial** — livre dentro da pasta do projeto, aprovação para o resto;
  - **Total** — acesso completo; comandos irreversíveis externos conhecidos pedem confirmação.
    Codex tem rede, busca web e MCPs herdados ativos; comandos usam a sala.
- **Modos por agente**: leitura e escrita, só leitura ou só escrita, além de um papel livre
  (ex.: "arquiteto", "revisor").
- **Anexos**: texto, código, Markdown, imagens, PDF e Word. Imagens chegam aos agentes como imagens.
  Planilhas nunca são lidas por inteiro:
  o Orquestrador envia apenas cabeçalho e amostra de linhas, com limite de tamanho.
- **Estágio e perguntas guiadas**: acompanhe a fase de cada agente e receba perguntas com respostas
  sugeridas quando ele precisar de uma decisão; a sala pausa até a sua resposta.
- **Chat por voz**: fale com a sala pelo microfone e ouça as respostas dos agentes. A transcrição
  (whisper.cpp) e a leitura (voz do sistema) acontecem no seu computador; a gravação é apagada após a
  transcrição. Os componentes de voz são baixados só com a sua autorização.
- **Chats e memória persistente**: todas as conversas ficam no menu **Chats** (com busca) e voltam ao
  reabrir o VS Code; **Novo chat** começa do zero sem perder nada. A **memória** guarda preferências e
  decisões que os agentes recebem em todos os chats; propostas são salvas automaticamente no Total
  e pedem sua aprovação nos demais níveis.
- **Contexto de outros chats**: importe conversas anteriores do Claude Code, do Codex ou de outras salas.
- **Extensível**: novos agentes por manifesto ou por outras extensões (`FagulhaSoftware.orquestrador-fagulha`).

## Requisitos

- VS Code 1.95 ou superior.
- Pelo menos um agente:
  - [Claude Code](https://code.claude.com) (CLI ou extensão do VS Code), com uma conta Claude (chaves de API pertencem ao participante Anthropic separado);
  - [Codex](https://developers.openai.com/codex) (CLI ou extensão do VS Code), com uma conta ChatGPT (chaves de API pertencem ao participante OpenAI separado);
  - [Gemini CLI](https://geminicli.com), com uma chave do Google AI Studio;
  - Mistral Vibe / Mistral Code Enterprise via ACP, com perfis nativos separados por login no navegador; Mistral API usa um participante de chave separado;
  - [Ollama](https://ollama.com), rodando localmente;
  - ou uma chave de API de um provedor compatível.

O Orquestrador Fagulha não inclui nem revende acesso a modelos: cada usuário usa as próprias contas e
paga diretamente aos provedores, quando houver cobrança.

## Instalação

- **Pela loja do VS Code:** abra a aba Extensões (`Ctrl+Shift+X`), pesquise **Orquestrador Fagulha** e
  clique em **Instalar**.
- **Por arquivo `.vsix`:** baixe o pacote na página de [Releases](https://github.com/fagulhasoftware/fagulha_orquestrador/releases) e use
  *Extensões → `...` → Instalar do VSIX*, ou `code --install-extension orquestrador-fagulha-<versão>.vsix`.

Cada instalação é independente: o Orquestrador começa limpo, sem conversas, contas ou configurações de
outra pessoa.

## Primeiros passos

1. Abra o **Orquestrador Fagulha** na barra lateral.
2. Siga o assistente: escolha os agentes, faça login e defina o nível de permissão.
3. Escreva na sala mencionando um agente, por exemplo: `@claude explique a estrutura deste projeto`.

## Comandos e atalhos

Todas as menções, comandos do chat, atalhos de teclado, botões e configurações — e quando usar cada um — estão em
[docs/COMMANDS.pt-BR.md](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/docs/COMMANDS.pt-BR.md). O essencial: `@agente` aciona um agente, `@todos` aciona todos,
`/parar` interrompe o agente atual, `/lembrar <texto>` guarda uma memória, `Ctrl+Alt+V` inicia a voz.

## Privacidade

- Conversas, ações, aprovações e anexos ficam somente em `~/.orquestra/dados`, no seu computador.
- Credenciais ficam no SecretStorage do VS Code e nunca são gravadas em arquivo, log ou banco local.
- O Orquestrador não tem telemetria. As únicas conexões de rede são as que você ou seus agentes fazem
  com os provedores que você mesmo configurou.

Detalhes em [PRIVACY.pt-BR.md](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/PRIVACY.pt-BR.md).

## Limitações conhecidas

- Voz: instalação automática dos componentes no Windows; no macOS e no Linux, o assistente indica o comando
  de instalação do ffmpeg e do whisper.cpp.
- Planilhas `.xls`, `.xlsb` e `.ods` são recusadas; converta para `.xlsx` ou `.csv`.

## Desenvolvimento

Pré-requisitos: [Node.js](https://nodejs.org) 20 ou superior, Git e VS Code 1.95 ou superior.

```bash
git clone https://github.com/fagulhasoftware/fagulha_orquestrador.git
cd fagulha_orquestrador
npm install
npm run build        # compila a extensão, o servidor MCP e a interface em dist/
npm test             # testes automatizados (não usam rede real nem contas reais)
```

Para testar no VS Code, abra a pasta do projeto e pressione **F5**: uma nova janela ("Extension
Development Host") abre com a extensão carregada a partir do código-fonte.

Outros comandos:

| Comando | Para quê |
|---|---|
| `npm run check:webview` | Verificação estrita de tipos de todo o projeto |
| `npm run format` | Formata o código com Prettier |
| `npm run package` | Gera o `.vsix` e roda o verificador de privacidade do pacote |
| `npm run smoke:clis` | Detecta os CLIs instalados e mostra os argumentos montados, sem chamar modelos |

A arquitetura está descrita em [docs/ARQUITETURA.md](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/docs/ARQUITETURA.md).

## Contribuindo

Contribuições são bem-vindas: correções, novos agentes, melhorias de interface, documentação e traduções.
Leia o [guia de contribuição](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/CONTRIBUTING.pt-BR.md) e o
[código de conduta](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/CODE_OF_CONDUCT.pt-BR.md) antes de abrir uma *issue* ou um *pull request*.

## Segurança

Não relate vulnerabilidades em *issues* públicas. Siga a [política de segurança](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/SECURITY.pt-BR.md).

## Autoria

Produto da **Fagulha Software**, construído com o Codex (OpenAI) e o Claude (Anthropic).
Contribuição reconhecida: Fagulha Software 50%, Codex 30%, Claude 20%. Detalhes em
[AUTHORS.pt-BR.md](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/AUTHORS.pt-BR.md).

## Licença

[MIT](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/LICENSE) © Fagulha. Claude, Codex, ChatGPT, Gemini e Ollama são marcas de seus respectivos
titulares; o Orquestrador Fagulha é compatível com essas ferramentas, sem vínculo ou endosso oficial.

## Histórico: Codex no nível Total (0.3.0)

O Codex usa acesso completo a arquivos em modo leitura e escrita, busca web ao vivo e preserva os MCPs configurados pelo usuário. O modo somente leitura mantém o sandbox read-only. Shell nativo fica desligado: comandos usam `comando_executar`, com timeout, limite de saída e auditoria. Manual e Parcial mantêm o comportamento anterior.

Na CLI 0.160.0, a verificação local confirmou busca web e ausência de shell nativo; `apply_patch` também não foi oferecido nesse cenário. Use `arquivo_escrever` para editar. A disponibilidade de ferramentas nativas pode variar conforme a CLI e o modelo.

O Portão pede confirmação individual para comandos externos conhecidos de exclusão, destruição, push forçado e SQL destrutivo com host remoto explícito. O classificador é uma heurística: scripts, aliases, conexões remotas implícitas e ferramentas de MCPs herdados podem executar ações fora dessa classificação. Chamadas diretas aos MCPs e edições nativas não passam pelo Portão; a orientação no contexto não é uma barreira técnica. Ferramentas da sala continuam recusando destinos sensíveis conhecidos. Parar continua disponível. Esta entrega trata do acesso do Codex; voz neural e demais recursos planejados para 0.3.0 não estão incluídos.

## Antigravity e navegador dedicado

A partir de 0.4.1, use @antigravity, @ag ou @agy para o participante Antigravity CLI.
Disponivel em Total + leitura e escrita; niveis/modos restritos sao recusados ate validar isolamento.
O navegador dedicado permite navegar, preencher, clicar mediante confirmacao e capturar PNG.
Configuracao, limites e validacao: [docs/ANTIGRAVITY.md](docs/ANTIGRAVITY.md).

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
