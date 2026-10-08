# Histórico de versões

## 0.3.2

- Horários exibidos no fuso local, incluindo exportação em Markdown; armazenamento permanece em UTC.
- Imagens de anexos e arquivos chegam como conteúdo de imagem pelo MCP. Anexos aparecem com ID, nome, tipo e tamanho no contexto; leitura também aceita nome único.
- Diagnósticos específicos para anexos ausentes, nomes ambíguos, limites e tipos inválidos, sem divulgar erros internos ou segredos.
- Imagens da mensagem atual são fornecidas às CLIs nos níveis Parcial/Total; Manual mantém leitura via MCP e aprovação.
- Perguntas guiadas ficam junto à digitação; a fila aguarda a resposta ou o cancelamento e novos envios são recusados durante a espera.

## 0.3.1

- Registros de execução ficam recolhidos em uma linha, inclusive ações isoladas e resultados longos. Clique para consultar o conteúdo completo.
- Ações consecutivas do mesmo agente compartilham um bloco com horário, agente, quantidade e resumo. Falas e erros preservam sua posição na conversa.
- Blocos expandidos permanecem abertos durante as atualizações do chat; detalhes extensos têm rolagem própria.

## 0.3.0

- Codex Total: acesso completo a arquivos, rede, busca web ao vivo e MCPs herdados, inclusive em retomadas. Shell nativo desligado; comandos via sala.
- Total automatiza ações comuns e confirma comandos irreversíveis externos conhecidos, com categoria própria e auditoria. Manual e Parcial preservados.
- Interface e contexto explicam os limites de MCPs diretos e da classificação heurística.

- **Estágio do agente:** veja o que cada agente está fazendo (pensando, lendo, pesquisando na web,
  escrevendo, executando) e um sinal claro quando ele conclui, é interrompido ou encontra um erro.
- **Perguntas guiadas:** quando precisa de uma decisão, o agente abre uma caixa com as perguntas e
  respostas sugeridas, e aguarda a sua resposta antes de continuar.
- **Configuração única:** o assistente, o nível de permissão e as preferências valem para todas as
  janelas e pastas.
- **Voz mais natural:** a leitura automática fala só as perguntas, o anúncio antes de agir e o resumo
  ao concluir; motor Piper preparado e voz em nuvem opcional com chave validada no SecretStorage.
- A instalação da voz neural pt_BR aguarda uma voz com licença comercial e origem do modelo-base verificadas; voz do sistema continua disponível.

## 0.2.2

- Corrigido: ferramentas do Orquestrador (web, arquivos, memoria) recusadas para Claude e Codex antes do cartao de aprovacao.
- Diagnosticos da ponte distinguem variaveis ausentes, token revogado, argumentos invalidos e recusas no Portao.

## 0.2.1 — em desenvolvimento

- **Menu Chats:** todas as suas conversas, de qualquer projeto e janela, com busca, fixar, renomear,
  exportar e excluir.
- **Novo chat:** comece uma conversa limpa sem perder a anterior.
- **Conversa preservada:** ao fechar e abrir o VS Code ou abrir uma nova janela, o último chat da pasta
  volta automaticamente.
- **Memória persistente:** preferências e decisões que os agentes recebem em todos os chats, global ou por
  projeto. Agentes podem propor memórias, que só são salvas com a sua aprovação.

## 0.2.0 — em desenvolvimento

- **Chat por voz:** fale com a sala pelo microfone; a transcrição é feita no seu computador
  (whisper.cpp, modelo `small` por padrão) e a gravação é apagada em seguida.
- **Ouvir respostas:** leitura em voz alta das falas dos agentes com a voz do sistema, automática ou
  por mensagem.
- **Assistente de instalação da voz:** mostra origem e tamanho de cada componente e só baixa com a sua
  autorização, conferindo a integridade dos arquivos.
- Links para o repositório e para relatar problemas na página da extensão.

## 0.1.1

- Corrigido o bloqueio ao iniciar ou retomar conversas com o Codex quando há servidores MCP de plugins
  instalados. No nível Manual, a conversa só começa quando o isolamento pode ser garantido; nos demais
  níveis, a sala avisa se algum servidor MCP herdado continuar ativo.
- Configurações obsoletas no `config.toml` do Codex agora geram um aviso informativo, uma vez por sessão,
  sem marcar o agente como erro.

## 0.1.0 — 2026-10

Primeira versão pública.

- Sala por janela com Claude Code, Codex, Gemini CLI, Ollama e agentes por chave de API.
- Login pelo navegador ou por código de dispositivo; chaves de API validadas antes de serem guardadas.
- Níveis de permissão Manual, Parcial e Total, com aprovações e auditoria local.
- Anexos com limites de tamanho e amostragem de planilhas.
- Importação de contexto de outras conversas.
