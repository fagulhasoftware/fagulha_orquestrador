# Política de Privacidade — Orquestrador Fagulha

[English](PRIVACY.md)

Última atualização: 4 de outubro de 2026.

O Orquestrador Fagulha é uma extensão do VS Code que roda inteiramente no computador de quem a instala.
A Fagulha não opera servidores para esta extensão e **não recebe, armazena nem processa dados dos usuários**.

## Dados armazenados no seu computador

| Dado | Onde fica | Quem acessa |
|---|---|---|
| Conversas, ações, aprovações e auditoria da sala | `~/.orquestra/dados/orquestra.sqlite` | Somente você e os agentes que você habilitar |
| Anexos | `~/.orquestra/dados/anexos/` | Somente você e os agentes que você habilitar |
| Chaves de API | SecretStorage do VS Code (cofre do sistema operacional) | Somente a extensão, no seu computador |
| Logins do Claude Code e do Codex | Gerenciados pelos próprios CLIs, nas suas contas | Os respectivos provedores |

Para apagar todos os dados, desinstale a extensão e remova a pasta `~/.orquestra`. As chaves podem ser
removidas pelo botão "Sair" de cada agente.

## Conexões de rede

A extensão não possui telemetria nem análise de uso. Conexões de rede acontecem apenas quando:

- você faz login ou valida uma chave com um provedor (Anthropic, OpenAI, Google, ou o endereço que você configurar);
- um agente que você acionou conversa com o provedor dele;
- você ou um agente, com a sua aprovação conforme o nível de permissão, abre ou lê uma página web.

O conteúdo enviado aos provedores segue as políticas de privacidade de cada um deles.

## Exportação

Conversas só saem do seu computador se você usar explicitamente o comando "Exportar esta conversa".

## Contato

Fagulha — https://fagulha.net/contato
