# Comandos e atalhos

[English](COMMANDS.md) · **Português (Brasil)** · [Español](COMMANDS.es.md) · [Deutsch](COMMANDS.de.md)

Tudo o que você pode digitar, clicar ou configurar no Orquestrador Fagulha, e quando usar cada coisa.

## 1. Acionar agentes na sala

| Escreva | O que acontece | Quando usar |
|---|---|---|
| `@claude …` | Envia a mensagem ao Claude Code | Planejamento, arquitetura, revisões, explicações longas |
| `@codex …` | Envia a mensagem ao Codex | Implementação, refatoração, rodar e corrigir testes |
| `@gemini …` (também `@ag`, `@antigravity`) | Envia a mensagem ao Gemini CLI | Segunda opinião, pesquisa, leitura de contexto grande |
| `@ollama …` | Envia a mensagem ao seu modelo local do Ollama | Trabalho offline, rascunhos privados, dúvidas rápidas |
| `@openai …`, `@anthropic …`, `@geminiapi …`, `@openaicompativel …` | Envia a mensagem a um agente por chave de API | Quando você usa um provedor por chave de API em vez de CLI |
| `@todos …` | Envia a mensagem a todos os agentes habilitados | Pedir a opinião de todos, comparar respostas |
| Mensagem **sem** menção | Só fica registrada na sala; nenhum agente é acionado | Anotações, contexto para depois, instruções que você vai citar |
| Um agente escrevendo `@codex …` na resposta | Passa a palavra para esse agente | Agentes repassam trabalho entre si (limite: *Passagens automáticas*, seção 6) |

Dica: digite `@` na caixa de mensagem para ver sugestões; ↑/↓ escolhem, Enter ou Tab inserem, Esc fecha.

## 2. Comandos do chat

| Comando | O que faz | Quando usar |
|---|---|---|
| `/parar` (também `/stop`) | Interrompe o agente que está trabalhando e esvazia a fila | O agente seguiu um caminho errado ou está demorando demais |
| `/lembrar <texto>` (também `/remember`) | Guarda `<texto>` na memória deste projeto | Decisões e convenções do projeto ("use pnpm", "API em /services/api") |
| `/lembrar-global <texto>` (também `/remember-global`) | Guarda `<texto>` na memória global | Preferências pessoais válidas em todos os projetos ("responda em português formal") |

As memórias são enviadas a todos os agentes em todos os chats (Chats → Memória permite editar, desativar ou
excluir). Nunca guarde senhas ou chaves na memória.

## 3. Teclado

| Teclas | Onde | Ação |
|---|---|---|
| `Enter` | Caixa de mensagem | Enviar |
| `Shift+Enter` | Caixa de mensagem | Nova linha |
| `Ctrl+Alt+V` (`Cmd+Alt+V` no macOS) | Com o painel do Orquestrador aberto | Iniciar / parar a gravação de voz |
| `1`–`6` | Caixa de perguntas guiadas | Escolher uma opção da primeira pergunta sem resposta |
| `Enter` | Caixa de perguntas guiadas | Enviar as respostas |
| `Esc` | Caixa de perguntas guiadas | Pular a pergunta |
| `Enter` / `Esc` | Renomeando um chat | Salvar / cancelar |

## 4. Botões da sala

| Botão | Onde | Quando usar |
|---|---|---|
| **Parar** (quadrado) | Cabeçalho, enquanto um agente trabalha | Igual a `/parar` |
| **Novo chat** (+) | Cabeçalho | Começar uma conversa limpa; a atual fica em Chats |
| **Chats e memória** | Cabeçalho | Encontrar, reabrir, fixar, renomear, exportar ou excluir conversas; gerenciar memórias |
| **Agentes** | Cabeçalho | Habilitar agentes, fazer login, definir papel e modo de permissão |
| **Configurações** (engrenagem) | Cabeçalho | Nível de permissão, apelido, tópico, limites, voz, exportação |
| **Leitura automática** (alto-falante) | Cabeçalho | Ligar/desligar a leitura das respostas em voz alta |
| **Anexar** (clipe) | Caixa de mensagem | Anexar arquivos; também é possível colar imagens ou arrastar arquivos (inclusive do Explorer) |
| **Adicionar contexto** | Caixa de mensagem | Importar uma conversa anterior do Claude Code, do Codex ou de uma sala |
| **Microfone** | Caixa de mensagem | Falar em vez de digitar (transcrição local) |
| **Ouvir** (alto-falante numa resposta) | Cada resposta de agente | Ouvir aquela resposta |
| **Aprovar / Aprovar na sessão / Negar** | Cartão de aprovação | Decidir sobre uma ação do agente. *Aprovar na sessão* libera o mesmo tipo de ação daquele agente até o fim da sessão |
| **Responder / Pular** | Caixa de perguntas guiadas | Responder a uma pergunta do agente; a sala pausa até você responder |

## 5. Comandos do VS Code (Paleta de Comandos: `Ctrl+Shift+P`)

| Comando | Quando usar |
|---|---|
| `Orquestrador Fagulha: Abrir no editor` | Abrir a sala numa aba grande do editor em vez da barra lateral |
| `Orquestrador Fagulha: Falar / parar` | Iniciar ou parar a gravação de voz (igual a `Ctrl+Alt+V`) |
| `Developer: Reload Window` | Depois de instalar ou atualizar a extensão |

## 6. Configurações (`Ctrl+,` → pesquise "fagulha")

| Configuração | Padrão | Quando mudar |
|---|---|---|
| `fagulha.nivel` | `manual` | Nível inicial de permissão. Mude pelo painel (Total exige confirmação digitada) |
| `fagulha.passagensAutomaticas` | `6` | Quantas vezes os agentes podem passar a palavra entre si automaticamente; `0` desliga |
| `fagulha.timeoutMinutos` | `20` | Tempo máximo de uma resposta de agente |
| `fagulha.anexos.*` | ver painel | Limites de anexos (texto, imagens, PDF/Word, planilhas) |
| `fagulha.provedores.claude.comando`, `.codex.comando`, `.gemini.comando` | detecção automática | Só se o CLI estiver instalado num local incomum |
| `fagulha.provedores.ollama.modelo` / `.baseUrl` | automático | Escolher o modelo do Ollama ou um endereço remoto |
| `fagulha.provedores.openai-compativel.modelo` / `.baseUrl` | — | Usar qualquer servidor compatível com OpenAI (LM Studio, vLLM, OpenRouter…) |
| `fagulha.provedores.anthropic.modelo`, `.gemini-api.modelo` | padrão do provedor | Escolher um modelo específico para agentes por chave de API |

Chaves de API nunca ficam nas configurações: use **Agentes → Entrar** (elas vão para o SecretStorage do VS Code).

## 7. Níveis de permissão — qual usar

| Nível | Use quando |
|---|---|
| **Manual** | Projetos sensíveis, primeiro contato com a extensão, ou quando quiser aprovar cada ação |
| **Parcial** (recomendado) | Trabalho do dia a dia: os agentes leem e escrevem livremente dentro do projeto; o resto pede aprovação |
| **Total** | Automação de confiança em que você aceita os riscos mostrados na tela; comandos irreversíveis externos conhecidos ainda pedem confirmação |

## 8. Modos por agente (Agentes → Modo de permissão)

| Modo | Use quando |
|---|---|
| Leitura e escrita | O agente implementa alterações |
| Só leitura | Revisões, auditorias, explicações — o agente não deve alterar arquivos |
| Só escrita | O agente escreve só o que você anexar ou descrever, sem explorar o projeto |

## 9. Voz

1. Configurações → Voz → **Baixar e instalar** (uma vez, com seu consentimento).
2. Clique no microfone ou use `Ctrl+Alt+V`, fale e clique em **Parar e transcrever** (ou **Parar e enviar**, se o envio automático estiver ligado).
3. Diga "arroba claude" (ou "arroba codex", "arroba todos"…) para mencionar um agente por voz.
4. Ligue a **Leitura automática** para ouvir perguntas, anúncios e resumos dos agentes.
