# Contas nativas e APIs

Cada participante usa uma fonte de autenticacao explicita. Claude usa a conta Claude Code; Anthropic usa exclusivamente `fagulha.api.anthropic`. Codex usa ChatGPT; OpenAI usa exclusivamente `fagulha.api.openai-api`. Gemini CLI continua sendo uma integracao explicita por chave, identificada como API no painel; nao representa uma assinatura Google. Ollama e local. Nao existe fallback de conta nativa para API quando uma cota esgota.

O ambiente dos processos CLI remove fontes de inferencia herdadas sem modificar variaveis do usuario ou do Windows. Claude recebe configuracoes de sessao que desativam chaves, helpers e provedores de nuvem alternativos, preservando os recursos nativos em Total. Claude e Codex confirmam o login por conta antes de enviar o prompt; um status por API ou indeterminado recusa a inferencia. Politicas administradas continuam pertencendo ao fornecedor; nao sao alteradas pelo Orquestrador. O Claude embutido na extensao instalada tem prioridade sobre o PATH, exceto quando o usuario configura um executavel explicitamente.

## Mistral

- `@mistral` / `@vibe` / `@MistralVibe`: runtime ACP oficial da extensao Mistral Vibe, login delegado pelo navegador.
- `@MistralEnterprise` / `@mistralcode`: perfil de conta corporativa separado usando o runtime ACP; o acesso depende da licenca e das politicas da organizacao Mistral. O nome no painel nao comprova entitlement Enterprise nem controla a cobranca do fornecedor. A extensao legada Mistral Code baseada em outro protocolo nao e automatizada por este adaptador.
- `@MistralAPI`: API HTTP Mistral, chave no SecretStorage e modelo configurado separadamente. Usa o mesmo portal de ferramentas das outras APIs.

Os perfis Vibe e Enterprise possuem `VIBE_HOME` separados no armazenamento local da extensao. O runtime Mistral usa um keyring global por padrao, mesmo com diretorios separados. No processo ACP do Orquestrador, o backend Python `keyring.backends.fail.Keyring` impede acesso a esse keyring e aciona o armazenamento oficial do Vibe no diretorio do perfil. O Orquestrador nao abre nem copia esses arquivos de credenciais. O status exige `vibe_home_env_file`; credenciais do ambiente ou do keyring global sao recusadas. Sair remove apenas a credencial do perfil escolhido. Isso exige um novo login no Orquestrador, mesmo quando a extensao Mistral ja esta autenticada.

Esse isolamento foi validado no Windows. O adaptador recusa macOS, onde o runtime Mistral acessa o Keychain por outra via. Atualizacoes de runtime que nao confirmem o estado esperado tambem sao recusadas.

Na nuvem Mistral, deixe o endereco Enterprise vazio. Para dominio privado, configure `fagulha.provedores.mistral-enterprise.baseUrl` com a URL HTTPS do login corporativo (sem chaves). O fluxo utiliza os campos `action`, `signInTarget`, `domain` e `attemptId` dentro de `_meta` do login delegado oficial. A conclusao deve devolver o mesmo identificador de tentativa, `status=completed` e `persistResult=completed` antes da verificacao de status. O perfil corporativo nao cai automaticamente na nuvem publica quando esse dominio esta configurado.

ACP esta habilitado apenas em Total / leitura_escrita: isolamento dos modos restritos ainda nao comprovado. Permissoes ACP solicitadas pelo agente passam pelo Portao e valem apenas para a chamada. Recursos nativos executados sem pedir permissao ACP permanecem sujeitos ao funcionamento do runtime, como os demais adaptadores em Total. MCP da sala e fornecido ao criar ou retomar a sessao; tokens de ponte trafegam somente em memoria.

## Verificacao

Regressoes cobrem ambiente herdado, fonte API inesperada antes da inferencia, campos de login separados, MCP, sessoes ACP, logout e recusa de modos nao suportados. Testes simulados nao comprovam licenca, saldo ou limites de uma conta real.

Referencias: [Claude authentication](https://code.claude.com/docs/en/authentication), [Codex authentication](https://learn.chatgpt.com/docs/auth), [Mistral Vibe](https://docs.mistral.ai/vibe/code/vs-code-extension/install-authenticate), [ACP](https://agentclientprotocol.com/protocol/v1/initialization).
