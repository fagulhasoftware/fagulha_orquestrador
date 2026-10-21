# Orquestrador Fagulha 0.6.0 ? relatorio de entrega

Data: 21/10/2026. Entrega local; nao publicada no Marketplace nem instalada automaticamente.

## Frente 1 ? atividades e autonomia

Componente unico para todos os participantes agrupa acoes por ID do turno, incluindo mensagens tecnicas da sala. Grupo e acoes individuais usam details/summary com aria-expanded, operacao por teclado e duracao atualizada. Resposta final, erros, perguntas e aprovacoes permanecem fora. Metadados do turno persistem. Caminhos e comandos aparecem somente no detalhamento. Setting `fagulha.atividadesExpandidas` inicia recolhido por padrao.

Limite configuravel de passagens autonomas: 20 para 50. O valor padrao 6 foi preservado. Testes cobrem 50 transferencias (51 execucoes) e rejeitam 51 transferencias.

Evidencia: testes de agrupamento, isolamento de erros, turnos e persistencia; interface real em navegador com um grupo recolhido, erro e resposta final visiveis, expansao acessivel e detalhes ocultos inicialmente.

## Frente 2 ? TTS e causa da falha

Interface unica de provedores: Gemini, ElevenLabs e OpenAI. Chaves sao salvas exclusivamente via SecretStorage do VS Code, sem settings ou arquivos de audio. A UI usa campo password, limpa o campo no envio e exibe somente mascara. Catalogos, modelos, voz geral, voz por agente, velocidade e Testar voz ficam nas configuracoes. O audio MP3/WAV trafega em memoria para um unico painel; o host aguarda ACK com ID, respeita cancelamento e fechamento do painel. Falha de provedor cai para speechSynthesis com aviso unico. Bloqueio de autoplay oferece Ativar audio.

Causas comprovadas no codigo anterior: `leituraNuvemChave` e `leituraNuvemRemover` eram validados, mas faltavam no switch do host. A reproducao dependia de processos externos e nao tinha a recuperacao nativa agora implementada. O novo transporte webview inclui media-src blob/data na CSP. A chave de teste fornecida inicialmente retornou HTTP 401 missing_permissions/text_to_speech; depois de habilitada pelo usuario, o mesmo adaptador listou 9 modelos TTS e 21 vozes e gerou MP3 de 74.439 bytes com um modelo realmente retornado (`eleven_multilingual_v2`). O frontend recebeu esse audio e confirmou `concluido`, sem fallback nem player externo. Nao foi avaliada a saida fisica dos alto-falantes.

Gemini e OpenAI: contratos exercitados com servidores HTTP/WebSocket locais, sem chaves de conta; homologacao paga nessas contas permanece pendente. Nenhum provedor Anthropic de TTS foi implementado. Antigravity e ChatGPT nao transferem login para APIs de voz.

Falhas de microfone eram apresentadas como erro generico de gravar ou transcrever. Agora a sala identifica captura/FFmpeg versus transcricao/Whisper. Nao ha logs da outra maquina que permitam atribuir sua falha a um driver ou microfone especifico.

## Contratos oficiais consultados

- ElevenLabs: GET /v1/models (can_do_text_to_speech), GET /v2/voices paginado e POST /v1/text-to-speech/{voice_id}. https://elevenlabs.io/docs/api-reference/text-to-speech/convert.mdx e https://api.elevenlabs.io/openapi.json
- Gemini: GET /v1beta/models; POST /v1beta/interactions com response_format audio, speech_config e store:false. Modelos documentados gemini-3.8-flash-tts e gemini-3.8-flash-lite-tts, oferecidos somente se listados pela conta. GET /v1beta/voices quando disponivel; alternativa com vozes predefinidas oficiais. https://ai.google.dev/gemini-api/docs/speech-generation e https://ai.google.dev/api/interactions-api
- OpenAI: GET /v1/models e wss://api.openai.com/v1/realtime para gpt-realtime-2.1-mini quando anunciado. Speech legado /v1/audio/speech para modelos anunciados tts-1, tts-1-hd e gpt-4o-mini-tts. A documentacao consultada recomenda Realtime e informa encerramento do Speech legado em 06/01/2027. Vozes sao as listas oficiais por familia; nao ha listagem de vozes equivalente a ElevenLabs. https://developers.openai.com/api/docs/guides/text-to-speech e https://developers.openai.com/api/docs/guides/realtime-audio

## Frente 3 ? inventario antes/depois

| Item | Antes | Depois / motivo |
| --- | --- | --- |
| npm | Sem SDK ou player de audio dedicado; ws, zod, unzipper e modulos Node compartilhados | Nenhuma dependencia npm nova; compartilhadas mantidas para seus outros usos |
| Piper | Catalogo/instalador/deteccao/runtime; download opcional 22.477.236 bytes, sem voz pt-BR validada | Removido do produto; configuracao antiga migra para sistema |
| eSpeak NG / ONNX do Piper | DLLs, dados e licencas no instalador opcional | Caminho de instalacao e uso removido junto ao Piper |
| System.Speech / SoundPlayer / say / afplay / espeak-ng / aplay | Processos externos para sintese/reproducao, conforme SO | Removidos da leitura; HTMLAudioElement e speechSynthesis no webview |
| Temporarios de leitura | Texto/audio para players locais | Removidos; Blob URL revogada e audio somente em memoria |
| FFmpeg | Captura do microfone; download opcional 114.768.076 bytes | Mantido apenas para ditado opcional, dispensavel para ouvir mensagens |
| Whisper.cpp | Transcricao local; download opcional 8.194.445 bytes | Mantido apenas para ditado opcional |
| Modelo Whisper | Base 147.951.465; small 487.601.967; medium 1.533.763.059 bytes | Um modelo selecionado, somente para ditado; nenhum download exigido pela leitura |
| Drivers | Nenhum instalador de driver identificado no produto | Nenhum driver novo; permissao de microfone/SO continua relevante ao ditado |

Arquivos de ferramentas ja instaladas pelo usuario foram preservados. A economia do download opcional do Piper nao equivale a economia no VSIX: os binarios ja nao eram incluidos no pacote.

## Preservacao e limites

As alteracoes anteriores de Model Picker, fallback, sequencia/ID de contexto, descarte de callbacks antigos, recuperacao e Mistral auto-approve permanecem na entrega. Sua validacao automatizada integra a suite final. Nao se afirma nova homologacao de ferramenta Mistral numa sala autenticada real nesta etapa. O diagnostico anterior, feito antes da correcao, esta em DIAGNOSTICO_CONTEXTO_050.md; a contaminacao no replay ACP foi reproduzida, mas nao prova todas as causas na outra maquina.

Testes legados de players e Piper foram substituidos por contratos HTTP/Realtime, audio em memoria, cancelamento/ACK por painel, fallback unico, catalogos, SecretStorage, migracao e ausencia de processos externos na deteccao de leitura. O offline depende das vozes disponibilizadas pelo webview/SO; a extensao nao instala vozes.

## Verificacao e tamanho

VSIX anterior 0.5.0: 3.374.682 bytes. Resultado final e diferenca: ver EVIDENCIAS_060.md, gerado apos empacotamento.
