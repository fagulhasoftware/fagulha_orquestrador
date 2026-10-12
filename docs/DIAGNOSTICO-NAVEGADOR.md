# Controle do Chrome: diagnostico e compatibilidade

## Erro de inicializacao

O browser-client do plugin Chrome 26.623.31921 substitui `globalThis.process` durante a importacao. Em hosts que protegem esse global, a linha 33 falha com `Cannot redefine property: process`, antes da conexao ao navegador. Isso foi reproduzido no controlador real, independentemente do Portao do Orquestrador.

A correcao mantem o shim do modulo em aliases privados `process` e `global`. O global protegido do host, o kernel, as permissoes e o Portao permanecem preservados. A dependencia que usa `global.process.on` tambem recebe o shim privado.

Para aplicar a mesma correcao a essa versao exata, execute `node scripts/corrigir-browser-runtime.cjs <caminho-absoluto/browser-client.mjs>`. O script verifica o SHA-256 da versao diagnosticada, salva backup e recusa outras versoes. Ele nao e executado automaticamente pela extensao e nao instala o conector nativo. Atualizacoes/reinstalacoes do plugin podem substituir a correcao local; confirme o codigo e a inicializacao novamente depois delas.

## Conexao com Chrome

Depois da correcao, a inicializacao e a documentacao de diagnostico funcionaram; a descoberta ainda retornou zero navegadores. O Chrome estava aberto, mas o registro Windows do host `com.openai.codexextension` e seu manifesto estavam ausentes. Sao falhas distintas.

O procedimento suportado pela documentacao `chrome-troubleshooting` do plugin e reinstalar o plugin Chrome pela interface de plugins do Codex, em vez de criar manualmente o host/registro. Depois, reconecte a extensao do Chrome e teste a descoberta e a leitura das abas pela ferramenta suportada. Uma lista vazia nao comprova acesso ao Chrome.

Nenhuma credencial, cookie, sessao autenticada ou conteudo de pagina foi extraido. Nenhuma publicacao no X foi realizada. A 0.3.2 do Orquestrador nao corrige, por si so, o codigo instalado do plugin Chrome.
