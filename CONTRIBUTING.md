# Guia de contribuição

Obrigado pelo interesse em contribuir com o Orquestrador Fagulha. Este guia explica como propor
mudanças de forma que elas possam ser revisadas e incorporadas com segurança.

Ao participar, você concorda com o nosso [código de conduta](CODE_OF_CONDUCT.md).

## Formas de contribuir

- **Relatar um erro:** abra uma *issue* com o modelo "Relatar erro".
- **Sugerir uma melhoria:** abra uma *issue* com o modelo "Sugerir melhoria" antes de começar a programar,
  para alinharmos a abordagem.
- **Corrigir ou implementar:** escolha uma *issue* (as marcadas `boa primeira contribuição` são um bom começo),
  comente que vai trabalhar nela e abra um *pull request*.
- **Adicionar um agente:** novos agentes podem entrar por manifesto ou por outra extensão; veja a seção 4 de
  [docs/ARQUITETURA.md](docs/ARQUITETURA.md).
- **Documentação e traduções:** correções de texto são sempre bem-vindas.

Vulnerabilidades **não** devem ser relatadas em *issues*; siga a [política de segurança](SECURITY.md).

## Preparando o ambiente

Pré-requisitos: Node.js 20 ou superior, Git e VS Code 1.95 ou superior.

```bash
git clone https://github.com/fagulhasoftware/fagulha_orquestrador.git
cd fagulha_orquestrador
npm install
npm run build
npm test
```

Pressione **F5** no VS Code para abrir uma janela de desenvolvimento com a extensão carregada.
Para testar agentes reais, use **as suas próprias contas**; os testes automatizados nunca usam contas,
chaves ou rede reais.

## Fluxo de trabalho

1. Faça um *fork* do repositório e crie uma branch a partir de `main`:
   `git checkout -b correcao/descricao-curta` (ou `recurso/…`, `docs/…`).
2. Faça mudanças pequenas e focadas: um *pull request* resolve um assunto.
3. Escreva ou atualize testes para o comportamento alterado.
4. Antes de enviar, rode:
   ```bash
   npm run format
   npm run check:webview
   npm test
   npm run package
   ```
   O `npm run package` também executa o **verificador de privacidade**, que impede que o pacote contenha
   caminhos pessoais, e-mails, chaves ou arquivos locais. Ele precisa passar.
5. Abra o *pull request* preenchendo o modelo e descrevendo o que mudou e como testou.

## Padrão de commits

Use o formato [Conventional Commits](https://www.conventionalcommits.org/pt-br/), em português:

```
tipo: descrição curta no imperativo

Explicação opcional do porquê da mudança.
```

Tipos usados: `feat` (recurso), `fix` (correção), `docs`, `test`, `refactor`, `chore`, `perf`.
Exemplo: `fix: recusar planilha xlsb antes de copiar o anexo`.

## Regras do projeto

Estas regras protegem os usuários e não são negociáveis:

1. **Dados somente locais.** Nenhuma funcionalidade pode enviar dados do usuário para servidores da
   Fagulha ou de terceiros, nem incluir telemetria. Rede só para os provedores que o próprio usuário configurou.
2. **Segredos só no SecretStorage do VS Code.** Chaves e tokens nunca vão para arquivos, logs, banco local,
   mensagens da sala, prompts ou para a interface.
3. **Toda ação de agente passa pelo Portão de Permissões.** Novas ferramentas devem declarar a categoria
   de ação e respeitar a matriz de permissões (`src/permissions/matriz.ts`), com testes.
4. **Limites de anexos são rígidos.** Planilhas e arquivos grandes nunca são lidos por inteiro.
5. **Sem dependências nativas.** Nada que exija compilação para o Electron do VS Code.
6. **Nada pessoal no repositório.** Não versione arquivos de `~/.orquestra`, bancos `.sqlite`, logs, `.env`,
   pacotes `.vsix`, caminhos da sua máquina ou dados reais em testes; use dados fictícios (`@example.com`).

## Contrato entre interface e extensão

A interface (`src/webview/`) e a extensão (`src/extension.ts`, `src/core/`, …) conversam somente pelos tipos
de `src/shared/protocolo.ts`. Mudanças nesse arquivo afetam os dois lados: descreva-as no *pull request*
e, se mudarem o formato de mensagens existentes, aumente `VERSAO_PROTOCOLO`.

## Revisão

Um mantenedor revisará o *pull request*. Podemos pedir ajustes; isso é parte normal do processo.
*Pull requests* que violem as regras do projeto não serão incorporados.

## Licença das contribuições

Ao enviar uma contribuição, você concorda que ela seja licenciada sob a [licença MIT](LICENSE) do projeto.
