# Evidencias finais ? 0.6.0

- Suite final: 422 testes, 422 aprovados, 0 falhas (test-final-060.log).
- TypeScript host e webview aprovados.
- Empacotamento e privacidade: 203 arquivos inspecionados, sem dados pessoais, segredos ou arquivos proibidos.
- Smoke do VSIX: host, SQLite WASM, TSV e extracao de PDF aprovados; sem node_modules e sem instalacao externa. PDF.js emite avisos de canvas opcional ausente no teste Node; renderizacao de PDF nao foi homologada nesta entrega.
- Verificacao adicional: conteudo da chave ElevenLabs fornecida ausente de todos os arquivos do VSIX.
- ElevenLabs real: catalogo e sintese aprovados depois da permissao text_to_speech; MP3 74.439 bytes reproduzido pelo frontend com ACK concluido, sem player externo. Sem verificacao acustica dos alto-falantes.
- Interface: agrupamento, expansao, erro e resposta final validados em navegador com estado sintetico. Instalacao/reload e teste na sala autenticada do VS Code permanecem pendentes.

| Artefato | Bytes |
| --- | ---: |
| orquestrador-fagulha-0.5.0.vsix (base) | 3.374.682 |
| orquestrador-fagulha-0.6.0.vsix | 3.379.740 |
| Diferenca | +5.058 (+0,15%) |

SHA-256 final: CFA3575104BFB06EAFB145AB05FDCF0DE09487A0B79F3BD6DACA6447A59CC4D1

O VSIX cresceu ligeiramente com os recursos novos. A remocao do Piper reduz downloads/componentes opcionais, sem eliminar binarios do VSIX, que ja os excluia.
