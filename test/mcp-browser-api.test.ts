import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { writeFile, readFile } from 'node:fs/promises';
import { PonteHttp } from '../src/mcp/ponte';
import { ExecutorFerramentas, comandoCritico } from '../src/mcp/executor';
import { Sala } from '../src/core/sala';
import { agentePadrao, type Provedor } from '../src/providers/tipos';
import { ProvedorApi, type ApiId } from '../src/providers/api';
import { lerPagina, validarUrl } from '../src/browser/pagina';
import { temporario, banco } from './apoio';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
test('ponte loopback autentica capacidade, recusa origin e revoga sessao', async () => {
  const ponte = new PonteHttp(async (agente, nome) => ({ agente, nome }));
  await ponte.iniciar();
  try {
    const controle = new AbortController(),
      c = ponte.criar('codex', controle.signal);
    const body = JSON.stringify({ nome: 'sala_ler', args: {} });
    assert.equal((await fetch(ponte.url, { method: 'POST', body })).status, 401);
    assert.equal(
      (
        await fetch(ponte.url, {
          method: 'POST',
          body,
          headers: { authorization: 'Bearer ' + c.token, origin: 'https://example.com' },
        })
      ).status,
      403,
    );
    const r = await fetch(ponte.url, {
      method: 'POST',
      body,
      headers: { authorization: 'Bearer ' + c.token },
    });
    assert.equal(r.status, 200);
    assert.equal(((await r.json()) as any).resultado.agente, 'codex');
    c.revogar();
    assert.equal(
      (
        await fetch(ponte.url, {
          method: 'POST',
          body,
          headers: { authorization: 'Bearer ' + c.token },
        })
      ).status,
      401,
    );
  } finally {
    await ponte.finalizar();
  }
});
test('MCP stdio real lista e executa ferramentas pela ponte', async () => {
  const ponte = new PonteHttp(async () => ({ ok: true }));
  await ponte.iniciar();
  const controle = new AbortController(),
    c = ponte.criar('claude', controle.signal);
  const cliente = new Client({ name: 'teste', version: '1.0' });
  const transporte = new StdioClientTransport({
    command: process.execPath,
    args: [resolve('dist/mcp-servidor.js')],
    env: { ORQUESTRA_BRIDGE_URL: c.url, ORQUESTRA_BRIDGE_TOKEN: c.token },
    stderr: 'pipe',
  });
  try {
    await cliente.connect(transporte);
    assert.equal(cliente.getServerVersion()?.name, 'fagulha_orquestrador');
    const lista = await cliente.listTools();
    assert.equal(lista.tools.length, 11);
    const resposta = await cliente.callTool({ name: 'sala_ler', arguments: {} });
    assert.equal(resposta.isError, undefined);
    assert.deepEqual(JSON.parse((resposta.content as any)[0].text), { ok: true });
  } finally {
    await cliente.close();
    await ponte.finalizar();
  }
});
test('ferramentas gravam apos portao; sobrescrita critica e segredos bloqueados', async () => {
  const tmp = await temporario();
  try {
    const sala = new Sala('s', tmp.pasta, 'Sala', await banco(tmp.pasta));
    const agente = agentePadrao('codex', 'Codex', 'cli', 'verde');
    agente.instalado = true;
    agente.habilitado = true;
    sala.registrar({
      agente,
      detectar: async () => ({ instalado: true }),
      estadoLogin: async () => 'conectado',
      login: async () => {},
      executar: async () => {},
    });
    await sala.iniciar();
    sala.config.nivel = 'parcial';
    const executor = new ExecutorFerramentas(sala, [tmp.pasta], async () => {});
    const sinal = new AbortController().signal;
    const caminho = join(tmp.pasta, 'arquivo.txt');
    await executor.executar('codex', 'arquivo_escrever', { caminho, texto: 'primeiro' }, sinal);
    assert.equal(await readFile(caminho, 'utf8'), 'primeiro');
    const off = sala.observar((e) => {
      if (e.tipo === 'aprovacao') {
        assert.equal(e.pedido.critica, true);
        queueMicrotask(() => sala.portao.responder(e.pedido.id, 'negar'));
      }
    });
    await assert.rejects(
      executor.executar('codex', 'arquivo_escrever', { caminho, texto: 'segundo' }, sinal),
    );
    off();
    assert.equal(await readFile(caminho, 'utf8'), 'primeiro');
    await assert.rejects(
      executor.executar('codex', 'arquivo_ler', { caminho: join(tmp.pasta, '.env') }, sinal),
    );
    await assert.rejects(
      executor.executar('codex', 'comando_executar', { comando: 'Get-Content .env' }, sinal),
    );
    await sala.esperar();
  } finally {
    await tmp.limpar();
  }
});
test('Claude nativo: manual recusa; workspace automatico; Bash parcial aprova; leitura nao escreve', async () => {
  const tmp = await temporario();
  try {
    const sala = new Sala('s', tmp.pasta, 'Sala', await banco(tmp.pasta));
    const agente = agentePadrao('claude', 'Claude', 'cli', 'amarelo');
    sala.registrar({
      agente,
      detectar: async () => ({ instalado: true }),
      estadoLogin: async () => 'conectado',
      login: async () => {},
      executar: async () => {},
    });
    await sala.iniciar();
    const executor = new ExecutorFerramentas(sala, [tmp.pasta], async () => {}),
      sinal = new AbortController().signal;
    const aprovar = (tool_name: string, input: Record<string, unknown>) =>
      executor.executar('claude', 'aprovar', { tool_name, input }, sinal) as Promise<{
        behavior: string;
      }>;
    assert.equal(
      (await aprovar('Write', { file_path: join(tmp.pasta, 'novo.txt') })).behavior,
      'deny',
    );
    sala.config.nivel = 'parcial';
    assert.equal(
      (await aprovar('Write', { file_path: join(tmp.pasta, 'novo.txt') })).behavior,
      'allow',
    );
    let pedidos = 0;
    const off = sala.observar((e) => {
      if (e.tipo === 'aprovacao') {
        pedidos++;
        queueMicrotask(() => sala.portao.responder(e.pedido.id, 'aprovar'));
      }
    });
    assert.equal((await aprovar('Bash', { command: 'echo teste' })).behavior, 'allow');
    assert.equal(pedidos, 1);
    assert.equal((await aprovar('Read', { file_path: join(tmp.pasta, '.env') })).behavior, 'deny');
    agente.modo = 'leitura';
    assert.equal(
      (await aprovar('Write', { file_path: join(tmp.pasta, 'novo.txt') })).behavior,
      'deny',
    );
    assert.equal((await aprovar('Bash', { command: 'echo teste' })).behavior, 'deny');
    assert.equal((await aprovar('FerramentaSemPolitica', {})).behavior, 'deny');
    off();
    await sala.esperar();
  } finally {
    await tmp.limpar();
  }
});
test('shell complexo/destrutivo/publicacao exige aprovacao individual; comando simples segue matriz', () => {
  assert.equal(comandoCritico('echo teste'), false);
  assert.equal(comandoCritico('git status'), false);
  for (const c of [
    'git push',
    'Remove-Item arquivo',
    'python script.py',
    'echo teste > arquivo',
    'echo $(comando)',
  ])
    assert.equal(comandoCritico(c), true);
});
test('browser HTTP extrai texto, limita bytes, recusa credenciais e redirecionamento sem portao', async () => {
  const servidor = createServer((req, res) => {
    if (req.url === '/grande') {
      res.end('x'.repeat(1024 * 1024 + 1));
    } else if (req.url === '/redirect') {
      res.writeHead(302, { location: '/ok' });
      res.end();
    } else {
      res.end('<style>oculto</style><h1>Ola</h1><script>secreto</script> mundo');
    }
  });
  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
  const port = (servidor.address() as any).port;
  const url = `http://127.0.0.1:${port}`;
  try {
    assert.equal(await lerPagina(url), 'Ola mundo');
    await assert.rejects(lerPagina(url + '/grande'), /limite/);
    await assert.rejects(lerPagina(url + '/redirect'), /autorizacao/);
    assert.throws(() => validarUrl('file:///x'));
    assert.throws(() => validarUrl('https://user:pass@example.com'));
  } finally {
    servidor.closeAllConnections();
    await new Promise<void>((r) => servidor.close(() => r()));
  }
});
for (const id of ['ollama', 'openai-compativel', 'anthropic', 'gemini-api'] as ApiId[])
  test(`API ${id}: ciclo de ferramenta com servidor local simulado`, async () => {
    let chamadas = 0,
      ferramentas = 0;
    const servidor = createServer(async (req, res) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      const b = JSON.parse(body);
      assert(b.model || b.contents);
      chamadas++;
      res.setHeader('content-type', 'application/json');
      const primeira = chamadas === 1;
      let resposta: unknown;
      if (id === 'anthropic')
        resposta = {
          content: primeira
            ? [{ type: 'tool_use', id: 't1', name: 'sala_ler', input: {} }]
            : [{ type: 'text', text: 'resposta final' }],
        };
      else if (id === 'gemini-api')
        resposta = {
          candidates: [
            {
              content: {
                parts: primeira
                  ? [{ functionCall: { name: 'sala_ler', args: {} } }]
                  : [{ text: 'resposta final' }],
              },
            },
          ],
        };
      else {
        const message = primeira
          ? {
              role: 'assistant',
              content: '',
              tool_calls: [
                {
                  id: 't1',
                  type: 'function',
                  function: { name: 'sala_ler', arguments: id === 'ollama' ? {} : '{}' },
                },
              ],
            }
          : { role: 'assistant', content: 'resposta final' };
        resposta = id === 'ollama' ? { message } : { choices: [{ message }] };
      }
      res.end(JSON.stringify(resposta));
    });
    await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
    const port = (servidor.address() as any).port;
    const falas: string[] = [];
    try {
      const prov = new ProvedorApi(
        id,
        { get: async () => 'fixture-value', store: async () => {} },
        () => ({ modelo: 'modelo-simulado', baseUrl: `http://127.0.0.1:${port}` }),
        async () => undefined,
      );
      await prov.executar(
        {
          prompt: 'teste',
          projeto: '.',
          modo: 'leitura_escrita',
          nivel: 'manual',
          ponte: { url: '', token: '', servidor: '', diretorio: '' },
          ferramenta: async (nome) => {
            assert.equal(nome, 'sala_ler');
            ferramentas++;
            return { mensagens: [] };
          },
        },
        {
          fala: (t) => falas.push(t),
          parcial: () => {},
          sessao: () => {},
          acao: () => {},
          erro: () => {},
        },
        new AbortController().signal,
      );
      assert.equal(chamadas, 2);
      assert.equal(ferramentas, 1);
      assert.deepEqual(falas, ['resposta final']);
    } finally {
      servidor.closeAllConnections();
      await new Promise<void>((r) => servidor.close(() => r()));
    }
  });
