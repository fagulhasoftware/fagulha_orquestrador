# Política de segurança

[English](SECURITY.md)

O Orquestrador Fagulha lida com credenciais e permite que agentes de IA leiam e alterem arquivos. Por isso,
tratamos relatos de segurança com prioridade.

## Versões suportadas

| Versão | Recebe correções de segurança |
|---|---|
| 0.1.x (mais recente) | Sim |
| Anteriores | Não |

## Como relatar uma vulnerabilidade

**Não abra uma *issue* pública.** Use um destes canais privados:

1. **GitHub (preferencial):** na aba **Security** do repositório, clique em
   **Report a vulnerability** para abrir um relato privado.
2. **Formulário de contato:** https://fagulha.net/contato, com o assunto "Segurança — Orquestrador Fagulha".

Inclua, se possível:

- versão da extensão, do VS Code e do sistema operacional;
- agentes envolvidos (Claude Code, Codex, Gemini CLI, API…) e o nível de permissão em uso;
- passos para reproduzir e o impacto esperado;
- uma prova de conceito, **sem** dados reais, chaves ou credenciais de ninguém.

## O que acontece depois

- Confirmamos o recebimento em até **5 dias úteis**.
- Avaliamos e informamos a gravidade e um prazo estimado de correção.
- Publicamos a correção e, com a sua autorização, damos crédito pelo relato nas notas da versão.

Pedimos que a vulnerabilidade não seja divulgada até que a correção esteja disponível.

## Escopo

Exemplos de problemas que nos interessam:

- vazamento de chaves, tokens ou conteúdo do SecretStorage;
- ações de agentes que contornem o Portão de Permissões ou a matriz de níveis;
- leitura de arquivos protegidos (`.env`, chaves, bancos locais) sem aprovação;
- envio de dados do usuário para fora do computador sem pedido explícito;
- execução de código a partir de anexos, páginas web ou conversas importadas.

Fora do escopo: vulnerabilidades dos próprios CLIs ou APIs dos provedores (relate diretamente a eles) e
riscos aceitos conscientemente pelo usuário ao escolher o nível de permissão **Total**.
