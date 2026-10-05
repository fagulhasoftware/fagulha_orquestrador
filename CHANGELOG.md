# Histórico de versões

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
