# Codex na sala: correcao 0.6.4

Data: 2026-11-13. Base: 0.6.0 com a correcao local de congelamento. Sem provedor Nemotron.

## Causa reproduzida

O historico da sala mostrou autenticacao ChatGPT confirmada e comandos executados, mas tambem itens error contendo o aviso de obsolescencia de features.multi_agent. O leitor de eventos os repassava a erro(), marcando o turno da sala como falho; a finalizacao da sala descarta a resposta de turnos falhos mesmo se a CLI concluir normalmente.

A CLI instalada codex-cli 0.169.0-alpha.11.1 foi testada com um prompt curto, sem ferramentas: emitiu o aviso, retornou FAGULHA_CODEX_OK e turn.completed com saida zero. Um teste de regressao do leitor falhou antes da correcao e passou depois.

## Mudanca

O aviso multi_agent conhecido e classificado de maneira estrita como informativo quando chega como item de aviso. Eventos terminais turn.failed/error e saida nao zero continuam sendo falhas. Nao ha edicao de configuracao global ou credenciais. O modo Manual continua recusando MCPs herdados cujo isolamento nao pode ser comprovado.

## Validacao

- 432 testes aprovados, incluindo aviso seguido de resposta, erro terminal preservado e CLI ficticia passando pelo adaptador.
- check:webview, build, empacotamento, verificacao de privacidade aprovados.
- Adaptador ProvedorCli real com autenticacao existente em Total: FAGULHA_PROVEDOR_OK, zero erros. O prompt proibiu ferramentas e alteracoes. Esta verificacao nao e interacao pelo painel real.
- No modo Manual, o teste encontrou um MCP herdado com transporte nao isolavel e foi recusado conforme o contrato; nao houve relaxamento dessa protecao.

Depois da instalacao, recarregar a janela e enviar uma mensagem ao Codex no painel para verificar o fluxo completo da UI. Logs brutos locais de prova e resultados extensos nao fazem parte do commit/pacote.
