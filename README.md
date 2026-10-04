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
  - **Total** — acesso completo com aviso de cada ação; ações críticas (apagar, publicar, credenciais)
    continuam pedindo aprovação.
- **Modos por agente**: leitura e escrita, só leitura ou só escrita, além de um papel livre
  (ex.: "arquiteto", "revisor").
- **Anexos**: texto, código, Markdown, imagens, PDF e Word. Planilhas nunca são lidas por inteiro:
  o Orquestrador envia apenas cabeçalho e amostra de linhas, com limite de tamanho.
- **Contexto de outros chats**: importe conversas anteriores do Claude Code, do Codex ou de outras salas.
- **Extensível**: novos agentes por manifesto ou por outras extensões (`fagulha.orquestrador-fagulha`).

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

## Primeiros passos

1. Abra o **Orquestrador Fagulha** na barra lateral.
2. Siga o assistente: escolha os agentes, faça login e defina o nível de permissão.
3. Escreva na sala mencionando um agente, por exemplo: `@claude explique a estrutura deste projeto`.

## Privacidade

- Conversas, ações, aprovações e anexos ficam somente em `~/.orquestra/dados`, no seu computador.
- Credenciais ficam no SecretStorage do VS Code e nunca são gravadas em arquivo, log ou banco local.
- O Orquestrador não tem telemetria. As únicas conexões de rede são as que você ou seus agentes fazem
  com os provedores que você mesmo configurou.

Detalhes em `PRIVACIDADE.md`, incluído na extensão.

## Limitações conhecidas

- Entrada por voz ainda não está disponível.
- Planilhas `.xls`, `.xlsb` e `.ods` são recusadas; converta para `.xlsx` ou `.csv`.

## Licença

MIT © Fagulha (arquivo `LICENSE` incluído). Claude, Codex, ChatGPT, Gemini e Ollama são marcas de seus respectivos
titulares; o Orquestrador Fagulha é compatível com essas ferramentas, sem vínculo ou endosso oficial.
