# Orquestrador Fagulha

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
- **Anexos**: texto, código, Markdown, imagens, PDF e Word. Planilhas nunca são lidas por inteiro:
  o Orquestrador envia apenas cabeçalho e amostra de linhas, com limite de tamanho.
- **Estágio e perguntas guiadas**: acompanhe a fase de cada agente e receba perguntas com respostas
  sugeridas quando ele precisar de uma decisão; o agente aguarda a sua resposta para continuar.
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
  - [Claude Code](https://code.claude.com) (CLI ou extensão do VS Code), com uma conta Claude ou do Anthropic Console;
  - [Codex](https://developers.openai.com/codex) (CLI ou extensão do VS Code), com uma conta ChatGPT ou chave da OpenAI;
  - [Gemini CLI](https://geminicli.com), com uma chave do Google AI Studio;
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

## Privacidade

- Conversas, ações, aprovações e anexos ficam somente em `~/.orquestra/dados`, no seu computador.
- Credenciais ficam no SecretStorage do VS Code e nunca são gravadas em arquivo, log ou banco local.
- O Orquestrador não tem telemetria. As únicas conexões de rede são as que você ou seus agentes fazem
  com os provedores que você mesmo configurou.

Detalhes em [PRIVACIDADE.md](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/PRIVACIDADE.md).

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
Leia o [guia de contribuição](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/CONTRIBUTING.md) e o
[código de conduta](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/CODE_OF_CONDUCT.md) antes de abrir uma *issue* ou um *pull request*.

## Segurança

Não relate vulnerabilidades em *issues* públicas. Siga a [política de segurança](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/SECURITY.md).

## Autoria

Produto da **Fagulha Software**, construído com o Codex (OpenAI) e o Claude (Anthropic).
Contribuição reconhecida: Fagulha Software 50%, Codex 30%, Claude 20%. Detalhes em
[AUTORES.md](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/AUTORES.md).

## Licença

[MIT](https://github.com/fagulhasoftware/fagulha_orquestrador/blob/main/LICENSE) © Fagulha. Claude, Codex, ChatGPT, Gemini e Ollama são marcas de seus respectivos
titulares; o Orquestrador Fagulha é compatível com essas ferramentas, sem vínculo ou endosso oficial.

## Codex no nível Total (0.3.0)

O Codex usa acesso completo a arquivos em modo leitura e escrita, busca web ao vivo e preserva os MCPs configurados pelo usuário. O modo somente leitura mantém o sandbox read-only. Shell nativo fica desligado: comandos usam `comando_executar`, com timeout, limite de saída e auditoria. Manual e Parcial mantêm o comportamento anterior.

Na CLI 0.160.0, a verificação local confirmou busca web e ausência de shell nativo; `apply_patch` também não foi oferecido nesse cenário. Use `arquivo_escrever` para editar. A disponibilidade de ferramentas nativas pode variar conforme a CLI e o modelo.

O Portão pede confirmação individual para comandos externos conhecidos de exclusão, destruição, push forçado e SQL destrutivo com host remoto explícito. O classificador é uma heurística: scripts, aliases, conexões remotas implícitas e ferramentas de MCPs herdados podem executar ações fora dessa classificação. Chamadas diretas aos MCPs e edições nativas não passam pelo Portão; a orientação no contexto não é uma barreira técnica. Ferramentas da sala continuam recusando destinos sensíveis conhecidos. Parar continua disponível. Esta entrega trata do acesso do Codex; voz neural e demais recursos planejados para 0.3.0 não estão incluídos.
