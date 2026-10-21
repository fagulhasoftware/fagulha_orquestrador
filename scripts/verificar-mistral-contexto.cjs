// Smoke opcional com inferencia real na conta Mistral ja conectada.
// Nao faz login, nao salva credenciais e nao utiliza ferramentas.
const assert = require('node:assert/strict');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir, homedir } = require('node:os');
const { join, resolve } = require('node:path');
const { ProvedorMistral } = require('../test/.tmp/build/src/providers/mistral');
const { PonteHttp } = require('../test/.tmp/build/src/mcp/ponte');

(async () => {
  const pasta = await mkdtemp(join(tmpdir(), 'fagulha-contexto-smoke-'));
  const ponte = new PonteHttp(async (_id, nome) => {
    if (nome === '__ferramentas_listar') return [];
    throw Error('Smoke de contexto nao permite ferramentas.');
  });
  const p = new ProvedorMistral(
    'mistral-vibe',
    join(homedir(), '.orquestra', 'dados', 'contas', 'mistral-vibe'),
    {
      get: async () => undefined,
      store: async () => {
        throw Error('Smoke nao salva credenciais.');
      },
    },
  );
  try {
    assert((await p.detectar()).instalado, 'Runtime Mistral nao encontrado.');
    const catalogo = await p.listarModelos();
    assert(catalogo.modelos.length, 'Entre na conta Mistral e atualize o catalogo.');
    const modelo = catalogo.modelos[0];
    await ponte.iniciar();
    let sessao;
    for (const [indice, pergunta, esperado] of [
      [1, '1+1', '2'],
      [2, '2+2', '4'],
    ]) {
      const controle = new AbortController(),
        timer = setTimeout(() => controle.abort(), 45000);
      const c = ponte.criar('mistral-vibe', controle.signal);
      let resposta = '',
        ativo;
      try {
        const prompt = `[REQUISICAO smoke-${indice}; CONTEXTO_SEQ ${indice}]\nTeste autorizado. Nao use ferramentas. Responda apenas o resultado de ${pergunta}.`;
        await p.executar(
          {
            prompt,
            promptCompleto: prompt,
            projeto: pasta,
            modo: 'leitura_escrita',
            nivel: 'total',
            sessao,
            modelo: modelo.id,
            ponte: {
              url: c.url,
              token: c.token,
              servidor: resolve('dist/mcp-servidor.js'),
              diretorio: pasta,
            },
          },
          {
            modelo: (id) => (ativo = id),
            sessao: (id) => (sessao = id),
            parcial: (t) => (resposta += t),
            fala: () => {},
            acao: () => {},
            erro: (t) => {
              throw Error(t);
            },
          },
          controle.signal,
        );
        assert.equal(resposta.trim(), esperado, 'Replay ou resposta incorreta no turno atual.');
        assert.equal(ativo, modelo.id);
        console.log(
          JSON.stringify({
            turno: indice,
            retomada: indice === 2,
            modelo: ativo,
            resposta: resposta.trim(),
            sucesso: true,
          }),
        );
      } finally {
        clearTimeout(timer);
        controle.abort();
      }
    }
  } finally {
    await ponte.finalizar();
    await rm(pasta, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
