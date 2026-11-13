# Correcao local de congelamento - 0.6.0

Data: 2026-11-04. Base limpa: commit 3ed1cc6. A versao do manifesto permanece 0.6.0. O pacote nao inclui a implementacao abandonada do Nemotron.

## Evidencia antes da correcao

Consulta somente leitura ao banco local encontrou dois registros de turno Codex sem fim, iniciados em 2026-11-03T20:45:01.131Z e 2026-11-04T11:45:56.705Z. A configuracao tinha timeout de 20 minutos. O primeiro registro era exibido como trabalhando mesmo apos reabertura.

No codigo original, carregarChat reabria todos os registros registroTurno sem reconciliar seu dono. agruparAtividades apresentava todo turno sem fim como ativo, inclusive com zero acoes. O timer de execucao apenas chamava AbortController.abort; proximo continuava aguardando preparar/executar/limpar sem garantia de conclusao. Dois testes falharam antes da alteracao: reabertura de turno abandonado e cancelamento de provedor que ignora o sinal.

## Alteracoes

- Novos turnos registram PID e instancia; uma execucao identificavel em outra sala e preservada. Registros antigos sem dono ativo passam a interrompidos e seu fim usa a ultima atividade conhecida, sem apagar mensagens.
- Se o ultimo turno do agente foi abandonado, os cursores de sessao desse agente sao invalidados; a proxima execucao recebe o historico atual.
- Apos cancelamento, a preparacao ou provedor recebe dois segundos para encerrar. Se continuar pendente, sua saida fica isolada, a fila e liberada e outra instancia do mesmo agente fica bloqueada ate o encerramento confirmado.
- Limpeza e finalizacao de perguntas possuem prazo de cinco segundos. Preparacao concluida depois do cancelamento tem seu recurso revogado/limpo e nao inicia o provedor.
- Um teste antigo de anexos foi ajustado para configurar permissoes pela API persistida: alterar somente a memoria fazia a sincronizacao global cancelar o turno; a nova guarda corretamente impede enviar contexto ja cancelado.

## Verificacao e entrega

- 8 testes especificos de congelamento passaram.
- Suite completa: 430 aprovados, zero falhas.
- check:webview, build, smoke do VSIX e privacidade aprovados.
- Manifesto do VSIX confirmado como 0.6.0; comandos e implementacao Nemotron ausentes.
- VSIX instalado com --force; hash do bundle instalado igual ao compilado: 202DB21D682E9785A9682ECF4B9F3D9DDF100BAE3E792A1F117D16CC8FF1E3E8.
- VSIX SHA256: E82556CC0EB88262373DA3847900F169E32F735D795D37F121C0B696D8FD873D.
- Banco de conversas salvo antes da instalacao em backup local com integrity_check OK; bundle anterior tambem preservado.

Falta recarregar a janela para carregar o bundle novo e conferir a recuperacao no painel real. Os testes locais nao comprovam uma nova resposta autenticada do Codex. Um provedor externo que nao confirma encerramento permanece marcado como travado; isso e informado e nao bloqueia os outros agentes. Nenhum processo desconhecido foi encerrado, nenhum historico foi apagado e nao houve commit/push.

O codigo corrigido esta nesta worktree. A pasta original Orquestra conserva alteracoes antigas nao entregues neste pacote; nao a use para reconstruir esta correcao.
