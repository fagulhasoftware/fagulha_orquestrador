import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { connect } from 'node:net';
import { mkdir, writeFile, readFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { temporario } from './apoio';
import { Skills } from '../src/skills/gestor';
import { termoComposer, comandosSala } from '../src/core/comandos';
import { OAuthMcp } from '../src/integrations/oauth';
import { montarArgumentos } from '../src/providers/cli';
import { appsCodex, iconeApp } from '../src/providers/recursos';
import { conectarMcp } from '../src/integrations/cliente';
import { Sala } from '../src/core/sala';
import { agentePadrao } from '../src/providers/tipos';
import { banco } from './apoio';
import JSZip from 'jszip';

test('tentativa OAuth com cliente proprio nao apaga o cadastro sem tokens', async () => {
  const key = 'fagulha.integracao.proprio.oauth.client';
  const cofre = new Map([[key, JSON.stringify({ client_id: 'cliente-configurado' })]]);
  const oauth = new OAuthMcp('proprio', {
    get: async (k) => cofre.get(k),
    store: async (k, v) => { cofre.set(k, v); },
    delete: async (k) => { cofre.delete(k); },
  }, async () => {}, undefined, false);
  await assert.rejects(oauth.autorizar('url-invalida'));
  assert.equal(JSON.parse(cofre.get(key)!).client_id, 'cliente-configurado');
});

test('OAuth encerra callback mesmo com preconexao do navegador sem requisicao', async () => {
  const oauth = new OAuthMcp('preconexao', { get: async () => undefined, store: async () => {} }, async () => {});
  await oauth.iniciar(0);
  const socket = connect(Number(new URL(oauth.redirectUrl).port), '127.0.0.1');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
    await Promise.race([
      oauth.fechar(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Callback OAuth bloqueado pela preconexao')), 1000); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    socket.destroy();
    await oauth.fechar();
  }
});

test('@ participantes, # especialistas e / comandos permanecem namespaces separados', () => {
  assert.equal(termoComposer('@codex #fig', 11)?.prefixo, '#');
  assert.equal(termoComposer('/pau', 4)?.prefixo, '/');
  assert.equal(termoComposer('@claude', 7)?.prefixo, '@');
  assert.equal(termoComposer('a@b.com', 7), null);
  assert(comandosSala.some((c) => c.valor === 'pausar'));
  const codex = montarArgumentos('codex', 'leitura_escrita', 'total');
  assert(codex.includes('features.apps=true'));
  assert(!codex.includes('features.js_repl=false'));
  assert(!codex.includes('features.shell_tool=false'));
  const claude = montarArgumentos('claude', 'leitura_escrita', 'total');
  assert(!claude.includes('--setting-sources'));
  assert(!claude.includes('--disable-slash-commands'));
  const manual = montarArgumentos('claude', 'leitura_escrita', 'manual');
  assert(manual.includes('--strict-mcp-config'));
});

test('skills herdadas sao descobertas, lidas, ativadas e importadas sem modificar origem', async () => {
  const tmp = await temporario();
  let desligadas: string[] = [];
  const origem = join(tmp.pasta, 'agente', 'revisao');
  const propria = join(tmp.pasta, 'sala');
  await mkdir(origem, { recursive: true });
  await writeFile(
    join(origem, 'SKILL.md'),
    '---\nname: code-review\ndescription: Revisar codigo\n---\nVerifique autorizacao, regressao e contratos.',
  );
  const skills = new Skills(
    propria,
    [join(tmp.pasta, 'agente')],
    async () => desligadas,
    async (v) => {
      desligadas = v;
    },
  );
  try {
    assert.equal((await skills.listar()).length, 1);
    assert((await skills.ler('code-review')).includes('regressao'));
    await skills.alternar('code-review', false);
    await assert.rejects(skills.ler('code-review'), /desativada/);
    assert((await skills.ler('code-review', true)).includes('regressao'));
    await assert.rejects(skills.remover('code-review'));
    assert((await readFile(join(origem, 'SKILL.md'), 'utf8')).includes('regressao'));
    await skills.importar(origem);
    assert((await skills.listar()).find((s) => s.nome === 'code-review')?.ativa);
  } finally {
    await tmp.limpar();
  }
});

test('OAuth real com discovery, DCR, PKCE, state e tokens no cofre', async () => {
  const cofre = new Map<string, string>();
  let base = '';
  let issuer = '';
  let verifier = false;
  let callbacks = 0;
  const responder = async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('content-type', 'application/json');
    const path = new URL(req.url!, base).pathname;
    if (path === '/metadata-custom')
      return res.end(JSON.stringify({ resource: base + '/mcp', authorization_servers: [issuer] }));
    if (path.startsWith('/.well-known/oauth-authorization-server'))
      return res.end(
        JSON.stringify({
          issuer,
          authorization_endpoint: issuer + '/authorize',
          token_endpoint: issuer + '/token',
          registration_endpoint: issuer + '/register',
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['none'],
        }),
      );
    let body = '';
    for await (const c of req) body += c;
    if (path === '/mcp') {
      if (req.method !== 'POST') {
        res.writeHead(405);
        return res.end();
      }
      if (req.headers.authorization !== 'Bearer synthetic-oauth-access') {
        res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${base}/metadata-custom", scope="fixture:read"`);
        res.writeHead(401);
        return res.end('{}');
      }
      const j = JSON.parse(body);
      if (j.id === undefined) {
        res.writeHead(202);
        return res.end();
      }
      const result =
        j.method === 'initialize'
          ? {
              protocolVersion: j.params.protocolVersion,
              capabilities: { tools: {} },
              serverInfo: { name: 'oauth-fixture', version: '1' },
            }
          : j.method === 'tools/list'
            ? { tools: [{ name: 'get_fixture', inputSchema: { type: 'object', properties: {} } }] }
            : { content: [{ type: 'text', text: 'OAUTH_MCP_OK' }] };
      return res.end(JSON.stringify({ jsonrpc: '2.0', id: j.id, result }));
    }
    if (path === '/register') {
      const data = JSON.parse(body);
      res.writeHead(201);
      return res.end(JSON.stringify({ ...data, client_id: 'fagulha-synthetic' }));
    }
    if (path === '/token') {
      const p = new URLSearchParams(body);
      if (p.get('grant_type') === 'refresh_token') assert.equal(p.get('refresh_token'), 'synthetic-oauth-refresh');
      else {
        verifier = (p.get('code_verifier')?.length ?? 0) >= 43;
        assert.equal(p.get('code'), 'synthetic-code');
      }
      return res.end(
        JSON.stringify({
          access_token: 'synthetic-oauth-access',
          token_type: 'Bearer',
          refresh_token: 'synthetic-oauth-refresh',
          expires_in: 3600,
        }),
      );
    }
    res.writeHead(404);
    res.end('{}');
  };
  const http = createServer(responder);
  const authHttp = createServer(responder);
  await new Promise<void>((r) => authHttp.listen(0, '127.0.0.1', () => r()));
  issuer = `http://127.0.0.1:${(authHttp.address() as { port: number }).port}`;
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
  const oauth = new OAuthMcp(
    'fixture',
    {
      get: async (k) => cofre.get(k),
      store: async (k, v) => {
        cofre.set(k, v);
      },
      delete: async (k) => {
        cofre.delete(k);
      },
    },
    async (url) => {
      const u = new URL(url);
      assert.equal(u.searchParams.get('client_id'), 'fagulha-synthetic');
      assert.equal(u.searchParams.get('scope'), 'fixture:read');
      assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
      assert(u.searchParams.get('code_challenge'));
      const callback = new URL(u.searchParams.get('redirect_uri')!);
      callback.searchParams.set('code', 'synthetic-code');
      callback.searchParams.set('state', 'wrong');
      assert.equal((await fetch(callback)).status, 400);
      callback.searchParams.set('state', u.searchParams.get('state')!);
      assert.equal((await fetch(callback)).status, 200);
      callbacks++;
    },
  );
  try {
    cofre.set('fagulha.integracao.fixture.oauth.client', JSON.stringify({ client_id: 'registro-removido' }));
    await oauth.iniciar(0);
    await oauth.autorizar(base + '/mcp');
    assert(verifier);
    assert.equal(callbacks, 1);
    assert.equal((await oauth.tokens())?.access_token, 'synthetic-oauth-access');
    // Obriga a renovacao pelo transporte usando emissor em outra origem.
    await oauth.saveTokens({ ...(await oauth.tokens())!, access_token: 'expired-fixture-access' });
    const conexao = await conectarMcp(
      {
        id: 'fixture',
        nome: 'Fixture',
        personalizada: true,
        transporte: 'http',
        url: base + '/mcp',
        autenticacao: 'oauth',
        ativa: true,
      },
      undefined,
      15000,
      oauth,
    );
    try {
      assert.equal((await conexao.listar()).length, 1);
      assert.equal((await conexao.chamar('get_fixture', {})).content[0].type, 'text');
    } finally {
      await conexao.fechar();
    }
    assert(cofre.has('fagulha.integracao.fixture.oauth.client'));
    await oauth.invalidateCredentials('all');
    assert.equal(cofre.size, 0);
  } finally {
    await oauth.fechar();
    http.closeAllConnections();
    await new Promise<void>((r) => http.close(() => r()));
    authHttp.closeAllConnections();
    await new Promise<void>((r) => authHttp.close(() => r()));
  }
});
test('Apps nativos respeitam handshake, pagina e acesso; nao exportam campos privados', async () => {
  const tmp = await temporario();
  const script = join(tmp.pasta, 'apps.cjs');
  await writeFile(
    script,
    `require('node:readline').createInterface({input:process.stdin}).on('line',l=>{const j=JSON.parse(l);if(j.id===1)console.log(JSON.stringify({id:1,result:{}}));else if(j.method==='app/list')console.log(JSON.stringify({id:j.id,result:{data:[{id:'app-secret-id',name:j.params.cursor?'Canva':'Figma',isAccessible:!j.params.cursor,isEnabled:true,pluginDisplayNames:['installed'],privateToken:'never-export'}],nextCursor:j.params.cursor?null:'page2'}}));});`,
  );
  try {
    const r = await appsCodex({ cmd: process.execPath, prefixo: [script] });
    assert.equal(r.length, 2);
    assert.equal(r[0].disponivel, true);
    assert.equal(r[1].disponivel, false);
    assert(!JSON.stringify(r).includes('never-export'));
    assert(!JSON.stringify(r).includes('app-secret-id'));
  } finally {
    await tmp.limpar();
  }
});
test('/pausar interrompe e /continuar retoma o agente no mesmo chat', async () => {
  const tmp = await temporario();
  const db = await banco(tmp.pasta);
  const sala = new Sala('pause', tmp.pasta, 'Pause', db);
  let chamadas = 0;
  let iniciado!: () => void, retomado!: () => void;
  const primeiro = new Promise<void>((r) => (iniciado = r)),
    segundo = new Promise<void>((r) => (retomado = r));
  sala.registrar({
    agente: agentePadrao('codex', 'Codex', 'cli', 'verde'),
    detectar: async () => ({ instalado: true }),
    estadoLogin: async () => 'conectado',
    login: async () => {},
    executar: async (_p, ev, sinal) => {
      chamadas++;
      if (chamadas === 1) {
        iniciado();
        await new Promise<void>((_, reject) =>
          sinal.addEventListener('abort', () => reject(new Error('Interrompido')), { once: true }),
        );
      } else {
        ev.fala('Retomado pelo contexto');
        retomado();
      }
    },
  });
  try {
    await sala.iniciar();
    await sala.configurar({ nivel: 'total' }, 'ACEITO OS RISCOS');
    sala.enviar('@codex tarefa sintetica', []);
    await primeiro;
    sala.enviar('/pausar', []);
    await sala.esperar();
    assert.equal(chamadas, 1);
    sala.enviar('/continuar', []);
    await segundo;
    await sala.esperar();
    assert.equal(chamadas, 2);
  } finally {
    sala.parar();
    await sala.esperar();
    await db.finalizar();
    await tmp.limpar();
  }
});
test('ZIP de skill importa recursos e recusa traversal, ADS e nomes Windows ambiguos', async () => {
  const tmp = await temporario();
  const skills = new Skills(
    join(tmp.pasta, 'skills'),
    [],
    async () => [],
    async () => {},
  );
  try {
    for (const path of [
      '../escape/SKILL.md',
      '/escape/SKILL.md',
      'review/file:stream',
      'review/.. /SKILL.md',
    ]) {
      const z = new JSZip();
      z.file(path, '---\nname: review\ndescription: Fixture\n---\n');
      const p = join(tmp.pasta, 'bad.zip');
      await writeFile(p, await z.generateAsync({ type: 'nodebuffer' }));
      await assert.rejects(skills.importarZip(p, join(tmp.pasta, 'extract')));
    }
    const z = new JSZip();
    z.file('review/SKILL.md', '---\nname: review\ndescription: Fixture\n---\n');
    z.file('review/references/info.txt', 'recurso');
    const p = join(tmp.pasta, 'good.zip');
    await writeFile(p, await z.generateAsync({ type: 'nodebuffer' }));
    await skills.importarZip(p, join(tmp.pasta, 'extract'));
    assert.equal(
      await readFile(join(tmp.pasta, 'skills', 'review', 'references', 'info.txt'), 'utf8'),
      'recurso',
    );
    await skills.remover('review');
    assert.equal((await skills.listar()).length, 0);
  } finally {
    await tmp.limpar();
  }
});

test('icones nativos recusam URLs privadas, credenciais e parametros', () => {
  assert.equal(iconeApp('https://cdn.oaistatic.com/app.png'), 'https://cdn.oaistatic.com/app.png');
  for (const u of ['http://cdn.oaistatic.com/app.png', 'https://localhost/app.png', 'https://cdn.oaistatic.com.evil.test/a', 'https://cdn.oaistatic.com/a?token=x', 'https://user:pass@cdn.oaistatic.com/a']) assert.equal(iconeApp(u), undefined);
});
