const assert = require('node:assert/strict');
const { mkdtemp, rm, access } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { createServer } = require('node:http');
const { ProvedorCli } = require('../test/.tmp/build/src/providers/cli');
const { PonteHttp } = require('../test/.tmp/build/src/mcp/ponte');
const { NavegadorControlado } = require('../test/.tmp/build/src/browser/controle');
(async () => {
  const pasta = await mkdtemp(join(tmpdir(), 'fagulha-ag-smoke-'));
  const browser = new NavegadorControlado();
  const fixture = createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(
      '<title>Fagulha synthetic</title><input id="nome"><button id="ok" onclick="document.getElementById(\'saida\').textContent=document.getElementById(\'nome\').value">Confirmar</button><p id="saida"></p>',
    );
  });
  const chamadas = [];
  const ponte = new PonteHttp(async (agente, nome, args) => {
    assert.equal(agente, 'antigravity');
    chamadas.push(nome);
    if (nome === 'navegador_controlar') return browser.navegar(args.url);
    if (nome === 'navegador_estado') return browser.estado();
    if (nome === 'navegador_capturar') return browser.captura();
    if (nome === 'sala_ler') return { teste: 'sintetico', participantes: ['antigravity'] };
    if (nome === '__ferramentas_listar') return [];
    throw Error('Smoke permite somente leitura e navegador sintetico.');
  });
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), 120000);
  try {
    await new Promise((r) => fixture.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${fixture.address().port}`;
    await browser.navegar(url);
    await browser.preencher('#nome', 'Fagulha smoke');
    await browser.clicar('#ok');
    assert((await browser.estado()).includes('Fagulha smoke'));
    assert((await browser.captura()).conteudoMcp[0].data.length > 100);
    console.log(
      'PASS navegador real: navegar, preencher, clicar, estado e PNG; perfil temporario.',
    );
    await ponte.iniciar();
    const c = ponte.criar('antigravity', controle.signal);
    const p = new ProvedorCli('antigravity', async () => {});
    assert((await p.detectar()).instalado);
    let sessao,
      resposta = '',
      erros = [];
    await p.executar(
      {
        prompt: `Teste sintetico autorizado. Use SOMENTE MCP fagulha_orquestrador: chame navegador_controlar com url ${url}, depois navegador_estado e navegador_capturar. Nao use shell, arquivos, outros servidores nem rede externa. Responda AG_SMOKE_OK quando completar.`,
        projeto: pasta,
        modo: 'leitura_escrita',
        nivel: 'total',
        ponte: {
          url: c.url,
          token: c.token,
          servidor: resolve('dist/mcp-servidor.js'),
          diretorio: pasta,
        },
      },
      {
        sessao: (id) => (sessao = id),
        fala: (t) => (resposta += t),
        parcial: (t) => (resposta += t),
        acao: (t) => console.log(t),
        sistema: (t) => console.log(t),
        erro: (t) => erros.push(t),
      },
      controle.signal,
    );
    assert(sessao, 'CLI deve emitir conversation_id');
    console.log('Chamadas ponte:', chamadas.join(', ') || 'nenhuma');
    console.log('Resposta diagnostica:', resposta.slice(-1200));
    assert.deepEqual(erros, []);
    for (const nome of ['navegador_controlar', 'navegador_estado', 'navegador_capturar'])
      assert(chamadas.includes(nome), `MCP real nao chamou ${nome}`);
    assert(resposta.includes('AG_SMOKE_OK'));
    await assert.rejects(access(join(pasta, '.agents', 'mcp_config.json')));
    console.log(
      'PASS Antigravity real: autenticacao, sessao, stream e MCP navegador com PNG; configuracao temporaria removida.',
    );
  } catch (e) {
    console.error('Diagnostico smoke:', e.message);
    throw e;
  } finally {
    clearTimeout(timer);
    controle.abort();
    await ponte.finalizar();
    await browser.fechar();
    await new Promise((r) => fixture.close(r));
    await rm(pasta, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
