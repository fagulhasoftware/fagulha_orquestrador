# Diagnostico de contexto e modelos — 0.5.0

Diagnostico realizado antes da alteracao em 20/10/2026. O incidente foi relatado em outra maquina; nao foram disponibilizados os logs daquela execucao. A reproducao usa um servidor ACP sintetico, sem inferencia paga ou credenciais reais.

## Caminho do contexto

1. `extension.ts` abre `dados/orquestra.sqlite` no armazenamento local do Orquestrador. Configuracoes globais ficam em `globais`; mensagens, anexos, contextos e sessoes ficam vinculados ao chat.
2. `Sala.enviar` cria mensagens com UUID; `emitir` persiste usando `Armazenamento.gravarMensagem`. A fila da sala executa um participante por vez.
3. Antes do turno, `Sala.proximo` aguarda persistencias e relê o chat, anexos, contextos, memorias e `sessoes_provedor`. `montarContexto` compoe regras, participantes, anexos e conversa.
4. Sessoes nativas mantem historico proprio. O cursor `visto` determinava o historico incremental; sem sessao a sala usa as ultimas 40 mensagens, e o incremental fica limitado a 80. Cada mensagem tem limite de 3.000 caracteres e o corpo tem limite de 160.000, conservando o trecho recente. Memorias e importacoes tem orcamentos separados.
5. O Mistral roda em perfil `VIBE_HOME` isolado, inicializa ACP, valida conta e chama `session/new` ou `session/load`, ajusta `auto-approve`, envia `session/prompt` e encerra o processo. O ID da sessao permanece no SQLite e o historico nativo no perfil do runtime. Nenhum cache de resposta do Mistral foi encontrado no Orquestrador.

## Hipoteses e evidencias da 0.4.9

| Hipotese | Resultado |
| --- | --- |
| Snapshot/cache nao invalidado | Nao demonstrado. O chat e relido antes do turno. O cursor era apenas numerico, sem ancora que comprovasse a identidade do prefixo. |
| Retomada antiga do Mistral | Confirmado defeito de tratamento. `sessao` era atribuida antes de `session/load`; o callback aceitava `agent_message_chunk` imediatamente. ACP exige replay do historico durante load. |
| Corte conserva antigo e perde novo | Nao observado no corte global: `slice(-160000)` preserva o fim. O corte de cada mensagem conserva seus primeiros 3000 caracteres, limitacao documentada; nao explica sozinho o replay. |
| ID duplicado/deduplicacao | UUID repetido nao demonstrado. Confirmada duplicacao por dois caminhos: Mistral emite `parcial` e `fala`, e a sala gravava ambos com IDs diferentes. |
| Corrida nas escritas | Corrupcao nao reproduzida: storage tem fila serial, lock entre processos e substituicao atomica. Atualizar o timestamp de um stream podia alterar sua posicao e tornar o cursor numerico menos confiavel. |
| Processo travado/saida antiga | Travamento do processo da outra maquina nao demonstrado. Confirmado que callbacks `fala`, `acao` e `erro` podiam publicar depois do cancelamento. Havia timeout, sem deteccao de repeticao/recuperacao. |

A reproducao anterior a correcao emitiu `RESPOSTA ANTIGA. ` durante load e `2` durante prompt: o adaptador publicou `RESPOSTA ANTIGA. 2`. Isso comprova contaminacao, nao comprova a causa exata de toda alucinacao relatada. Tambem nao ha evidencia para afirmar se os outros agentes da outra maquina atrasaram.

Outro defeito encontrado: quando `loadSession` nao era suportado, o adaptador abria uma sessao nova, mas podia receber apenas o prompt incremental preparado para a sessao antiga.

## Correcao e limites

- Somente notificacoes recebidas durante o novo prompt viram resposta. Replay de load e ignorado, preservando `auto-approve` e o login isolado.
- O host associa cada turno a UUID, sequencia monotonicamente alocada no SQLite, chat e geracao de contexto. Callbacks cancelados sao descartados. Antes da confirmacao, a sala verifica mensagens externas persistidas por outras janelas. Metadados seguem no prompt e na mensagem final.
- Isso garante correlacao do transporte, nao permite provar qual contexto um modelo usou internamente. Um modelo pode responder incorretamente mesmo recebendo o prompt certo.
- Streaming e preview transitorio; a resposta e persistida uma unica vez ao concluir. Cursor so avanca em sucesso e com ancora de mensagem; sessao incompleta, de outro modelo ou legada sem ancora nao e retomada.
- Pergunta nova durante execucao cancela a saida antiga e recoloca o participante na fila com o contexto atual. Isso nao desfaz efeitos de ferramentas ja executadas.
- Repeticao textual exata normalizada entre perguntas diferentes, erro em pergunta aritmetica simples explicita (`1+1`, soma/multiplicacao de inteiros) ou timeout ativo geram recuperacao. Nao ha julgamento semantico geral nem sondagens pagas invisiveis. A repeticao e uma heuristica: respostas curtas legitimamente iguais podem causar reinicio.
- Recuperacao automatica e limitada a uma tentativa. O processo do turno e encerrado pelos adaptadores; a sessao e descartada e o turno seguinte reconstrói contexto atual. Persistindo o erro, o agente fica `travado`.
- `Reiniciar contexto do agente` ou `/reiniciar-contexto @agente` limpa somente a sessao daquele participante. Historico da sala, conta e permissoes permanecem.
- Modelos com erro de disponibilidade/permissao/cota voltam uma vez a Padrao / Auto. Nao muda conta nem API key, nem escolhe outro modelo pago silenciosamente. Se o padrao tambem estiver sem cota, mostra o erro e permite escolher outro modelo.

## Fontes do protocolo e parametros

- ACP replay: https://agentclientprotocol.com/protocol/session-setup
- ACP configuracao: `session/set_config_option`, categorias `model` e `thought_level`/`thinking`, conforme protocolo e schemas da extensao oficial instalada.
- Codex modelo: https://developers.openai.com/codex/cli/reference/
- Codex esforco: https://developers.openai.com/codex/config-reference/
- CLIs instaladas: `codex exec --help`, `claude --help`, `gemini --help`, `agy --help`, `agy models` (consultas sem inferencia). `agy models` devolveu IDs e rotulos da conta, sem exigencia de uma lista inventada.

Os testes permanentes ficam em `test/mistral.test.ts`, `test/modelos-saude.test.ts`, `test/sala.test.ts` e `test/chats-memoria.test.ts`.


## Verificacao real nesta maquina

- `agy models` anunciou seis opcoes. Duas inferencias reais, com IDs retornados por ele, tiveram status SUCCESS: Gemini 3.8 Flash (High) e Claude Sonnet 4.6 (Thinking), ambos responderam `2` para `1+1`.
- O catalogo local Codex tinha sete opcoes. GPT-6.1-Sol e GPT-6-Astra responderam `2` em chamadas reais usando `--model`.
- ACP Mistral anunciou Mistral Medium 3.5 e Devstral local, com niveis de esforco. Mistral Medium 3.5 foi selecionado pelo protocolo e respondeu `2`. Devstral local nao respondeu no limite de 45 segundos do teste e foi interrompido; nao foi validado como utilizavel nesta maquina.
- Claude Code e Gemini CLI: flags conferidas nos executaveis instalados, sem lista configurada nem teste de inferencia com selecao nesta verificacao.
- API/DeepSeek/Ollama: chamadas e troca no corpo HTTP cobertas por servidor sintetico; nenhuma chave de API real foi utilizada para inferencia. DeepSeek usa o adaptador compativel quando configurado, sem participante dedicado detectado neste checkout.
- Interface: bundle real renderizado no navegador com estado sintetico; troca produziu `agenteModelo`, esforco foi ocultado em modelo sem suporte e nao houve overflow horizontal no viewport verificado.

Smoke opcional de duas perguntas diferentes na mesma sessao Mistral: compile os testes e execute `node scripts/verificar-mistral-contexto.cjs`. Ele usa o primeiro modelo anunciado na conta ja conectada, nao faz login nem permite ferramentas; implica uso real da conta.


O smoke real de retomada Mistral passou: primeiro turno `1+1 -> 2`, segundo turno na mesma sessao `2+2 -> 4`, sem concatenar a resposta anterior. O primeiro teste tambem revelou que o runtime ACP persiste `active_model` em `config.toml`: selecionar o modelo local muda `_auth/status` para `auth_not_required`, inicialmente interpretado como desconectado pela politica de conta nativa. A implementacao agora protege as preferencias com lock entre execucoes do Orquestrador, snapshot apenas em memoria e restauracao ao encerrar, inclusive apos aborto. Nenhum arquivo de autenticacao e copiado. Se outro programa editar a configuracao durante a execucao, a sala avisa e preserva a edicao externa em vez de sobrescreve-la.

Timeout de um modelo explicitamente escolhido tambem tenta Padrao / Auto uma vez. A recuperacao por timeout no padrao continua limitada a uma tentativa; nao ha loop ilimitado.


A restauracao do perfil tambem foi verificada no runtime real apos selecionar o modelo local e abortar: `_auth/status` voltou ao estado de conta conectada. O teste nao valida inferencia local. Durante a suite, houve um `EPERM` transitorio na renomeacao atomica do SQLite no Windows; foi adicionada repeticao curta, limitada e testada para bloqueios de compartilhamento, sem remover o banco de destino. Esse evento nao comprova que o incidente remoto tenha a mesma causa.


## Resultado final do pacote

- Versao: 0.5.0.
- TypeScript/webview: aprovado.
- Suite automatizada: 422 testes aprovados, zero falhas.
- VSIX: 203 arquivos, 3.374.682 bytes; manifesto 0.5.0 confirmado.
- Guarda de privacidade: aprovada, nenhum dado pessoal, segredo ou arquivo proibido detectado.
- Smoke do pacote: carregamento do host, SQLite WASM e extracao TSV/PDF aprovados com dependencias contidas no VSIX.
- SHA-256: `7CA2E9DB4426880C1617F8288A2A335672CF3E566F04FB2FC2D445831834644E`.
- Instalacao na outra maquina e verificacao do incidente original nao foram realizadas. Os testes reais descritos acima foram feitos nesta maquina; os demais usam fixtures e servidores sinteticos.
