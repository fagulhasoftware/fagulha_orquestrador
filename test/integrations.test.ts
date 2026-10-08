import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { categoriaFerramenta } from '../src/integrations/categoria';
import { catalogo } from '../src/integrations/catalogo';
import {
  Integracoes,
  urlIntegracao,
  type PersistenciaIntegracoes,
} from '../src/integrations/gestor';
import { conectarMcp } from '../src/integrations/cliente';
import type { RegistroIntegracao, ConexaoMcp } from '../src/integrations/tipos';
import { Portao } from '../src/permissions/portao';
import { configuracaoPadrao } from '../src/core/configuracao';
import { PonteHttp } from '../src/mcp/ponte';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { temporario } from './apoio';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { mensagemIntegracao, separarComando } from '../src/integrations/mensagens';
import { validarMensagem } from '../src/core/protocolo';
import { conteudoResultado } from '../src/mcp/conteudo';
const tools: Tool[] = ['get_item', 'update_item', 'send_message', 'delete_item'].map((name) => ({
  name,
  inputSchema: {
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
    additionalProperties: false,
  },
}));
function fixture(fabrica?: (r: RegistroIntegracao, token?: string) => Promise<ConexaoMcp>) {
  let registros: RegistroIntegracao[] = [];
  const valores = new Map<string, string>(),
    eventos: any[] = [],
    auditoria: any[] = [];
  const config = configuracaoPadrao();
  config.nivel = 'total';
  let decisao: 'aprovar' | 'negar' = 'aprovar';
  let antesDeAprovar: (() => Promise<void>) | undefined;
  const portao = new Portao(
    () => config,
    (e) => {
      eventos.push(e);
      if (e.tipo === 'aprovacao')
        queueMicrotask(async () => {
          await antesDeAprovar?.();
          portao.responder(e.pedido.id, decisao);
        });
    },
    async (r) => {
      auditoria.push(r);
    },
  );
  const persistencia: PersistenciaIntegracoes = {
    ler: async () => structuredClone(registros),
    salvar: async (r) => {
      registros = structuredClone(r);
    },
  };
  const segredos = {
    get: async (k: string) => valores.get(k),
    store: async (k: string, v: string) => {
      valores.set(k, v);
    },
    delete: async (k: string) => {
      valores.delete(k);
    },
  };
  const gestor = new Integracoes(persistencia, segredos, portao, (e) => eventos.push(e), fabrica);
  return {
    gestor,
    eventos,
    auditoria,
    valores,
    config,
    persistencia,
    segredos,
    portao,
    negar: () => {
      decisao = 'negar';
    },
    antesDeAprovar: (fn: () => Promise<void>) => {
      antesDeAprovar = fn;
    },
    registros: () => registros,
  };
}
async function httpMcp(op: { token?: string; delay?: number; redirect?: string } = {}) {
  const chamadas: string[] = [];
  const servidor = createServer(async (req, res) => {
    if (op.redirect) {
      res.writeHead(307, { location: op.redirect });
      res.end();
      return;
    }
    if (op.token && req.headers.authorization !== `Bearer ${op.token}`) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end();
      return;
    }
    let body = '';
    for await (const b of req) body += b;
    const j = JSON.parse(body);
    if (!Object.hasOwn(j, 'id')) {
      res.writeHead(202);
      res.end();
      return;
    }
    let result: unknown;
    if (j.method === 'initialize')
      result = {
        protocolVersion: j.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'fixture', version: '1' },
      };
    else if (j.method === 'tools/list') {
      if (op.delay) await new Promise((r) => setTimeout(r, op.delay));
      result = { tools };
    } else if (j.method === 'tools/call') {
      chamadas.push(j.params.name);
      result = { content: [{ type: 'text', text: `EXTERNO ${op.token ?? ''}` }], isError: false };
    } else {
      res.writeHead(404);
      res.end();
      return;
    }
    if (!res.destroyed) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: j.id, result }));
    }
  });
  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${(servidor.address() as any).port}/mcp`,
    chamadas,
    fechar: async () => {
      servidor.closeAllConnections();
      await new Promise<void>((r) => servidor.close(() => r()));
    },
  };
}
test('catalogo completo e categorias conservam anotacoes e prioridade destrutiva', () => {
  assert.deepEqual(
    catalogo.map((c) => c.id),
    [
      'figma',
      'github',
      'supabase',
      'notion',
      'gmail',
      'google-drive',
      'google-calendar',
      'm365-mail',
      'm365-calendar',
      'personalizada',
    ],
  );
  for (const c of catalogo) assert(c.documentacao.startsWith('https://'));
  const esperado = ['rede_leitura', 'externo', 'publicacao', 'irreversivel_externo'];
  tools.forEach((t, i) => assert.equal(categoriaFerramenta(t), esperado[i]));
  assert.equal(
    categoriaFerramenta({ name: 'deleteNote', annotations: { readOnlyHint: true } }),
    'irreversivel_externo',
  );
  assert.equal(
    categoriaFerramenta({ name: 'get_notes', annotations: { destructiveHint: true } }),
    'irreversivel_externo',
  );
  assert.equal(
    categoriaFerramenta({ name: 'misterio', annotations: { readOnlyHint: true } }),
    'rede_leitura',
  );
  assert.equal(categoriaFerramenta({ name: 'update_file' }, 'github'), 'publicacao');
  assert.equal(categoriaFerramenta({ name: 'misterio' }), 'externo');
  assert.equal(categoriaFerramenta({ name: 'deletefile' }), 'irreversivel_externo');
  assert.equal(categoriaFerramenta({ name: 'sendmail' }), 'publicacao');
  assert.equal(categoriaFerramenta({ name: 'getdata' }), 'rede_leitura');
});
test('HTTP real: valida token antes de guardar, prefixa, passa pelo Portao e mascara resultados', async () => {
  const token = 'credencial-ficticia-mcp-somente-teste';
  const servidor = await httpMcp({ token });
  const f = fixture();
  try {
    const id = await f.gestor.adicionar({
      nome: 'Servidor',
      url: servidor.url,
      autenticacao: 'token',
    });
    await assert.rejects(f.gestor.conectar(id, { token: 'token-incorreto' }));
    assert.equal(f.valores.size, 0);
    await f.gestor.conectar(id, { token });
    assert.equal(f.valores.size, 1);
    assert.equal((await f.gestor.ferramentas()).length, 4);
    for (const t of tools) {
      const r = await f.gestor.executar(
        'codex',
        'leitura_escrita',
        `${id}__${t.name}`,
        { id: '1' },
        new AbortController().signal,
      );
      assert(!JSON.stringify(r).includes(token));
      assert.match(JSON.stringify(r), /DADO EXTERNO NAO CONFIAVEL/);
    }
    assert.equal(f.eventos.filter((e) => e.tipo === 'aprovacao').length, 1);
    assert.deepEqual(
      f.auditoria.map((r) => r.categoria),
      ['rede_leitura', 'externo', 'publicacao', 'irreversivel_externo'],
    );
    assert(!JSON.stringify(f.registros()).includes(token));
    assert(!JSON.stringify(f.eventos).includes(token));
    assert(!JSON.stringify(f.auditoria).includes(token));
    f.negar();
    await assert.rejects(
      f.gestor.executar(
        'gemini',
        'leitura_escrita',
        `${id}__delete_item`,
        { id: '2' },
        new AbortController().signal,
      ),
    );
    assert.equal(servidor.chamadas.filter((n) => n === 'delete_item').length, 1);
    await assert.rejects(
      f.gestor.executar(
        'claude',
        'leitura',
        `${id}__update_item`,
        { id: '1' },
        new AbortController().signal,
      ),
    );
    await assert.rejects(
      f.gestor.executar(
        'codex',
        'leitura_escrita',
        `${id}__get_item`,
        { id: 1 },
        new AbortController().signal,
      ),
      /Argumentos invalidos/,
    );
    await f.gestor.desconectar(id);
    assert.equal(f.valores.size, 0);
    assert.deepEqual(await f.gestor.ferramentas(), []);
  } finally {
    await f.gestor.finalizar();
    await servidor.fechar();
  }
});
test('portal stdio real expoe e encaminha as mesmas ferramentas para qualquer agente', async () => {
  const servidor = await httpMcp();
  const f = fixture();
  let ponte: PonteHttp | undefined;
  const clients: Client[] = [];
  try {
    const id = await f.gestor.adicionar({ nome: 'Comum', url: servidor.url });
    await f.gestor.conectar(id);
    ponte = new PonteHttp(
      (agente, nome, args, sinal) =>
        f.gestor.executar(agente, 'leitura_escrita', nome, args, sinal),
      () => f.gestor.ferramentas(),
    );
    await ponte.iniciar();
    for (const agente of ['codex', 'claude', 'gemini', 'api']) {
      const cap = ponte.criar(agente, new AbortController().signal);
      const client = new Client({ name: 'teste', version: '1' });
      clients.push(client);
      await client.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: [resolve('dist/mcp-servidor.js')],
          env: { ORQUESTRA_BRIDGE_URL: cap.url, ORQUESTRA_BRIDGE_TOKEN: cap.token },
        }),
      );
      const lista = await client.listTools();
      assert(lista.tools.some((t) => t.name === `${id}__get_item`));
      const r = await client.callTool({ name: `${id}__get_item`, arguments: { id: '1' } });
      assert(!r.isError);
      assert.match(JSON.stringify(r.content), /DADO EXTERNO/);
    }
    assert.equal(servidor.chamadas.length, 4);
    assert.deepEqual(
      f.auditoria.map((r) => r.agente),
      ['codex', 'claude', 'gemini', 'api'],
    );
  } finally {
    await Promise.all(clients.map((c) => c.close()));
    await ponte?.finalizar();
    await f.gestor.finalizar();
    await servidor.fechar();
  }
});
test('servidor externo stdio real, alternancia e reconexao persistida', async () => {
  const tmp = await temporario();
  const f = fixture();
  try {
    const arquivo = join(tmp.pasta, 'servidor.cjs');
    await writeFile(
      arquivo,
      `const {Server}=require(${JSON.stringify(resolve('node_modules/@modelcontextprotocol/sdk/dist/cjs/server/index.js'))});const {StdioServerTransport}=require(${JSON.stringify(resolve('node_modules/@modelcontextprotocol/sdk/dist/cjs/server/stdio.js'))});const {ListToolsRequestSchema,CallToolRequestSchema}=require(${JSON.stringify(resolve('node_modules/@modelcontextprotocol/sdk/dist/cjs/types.js'))});const s=new Server({name:'local',version:'1'},{capabilities:{tools:{}}});s.setRequestHandler(ListToolsRequestSchema,async()=>({tools:${JSON.stringify(tools)}}));s.setRequestHandler(CallToolRequestSchema,async()=>({content:[{type:'text',text:'OK_STDIO'}]}));s.connect(new StdioServerTransport());`,
    );
    const id = await f.gestor.adicionar({
      nome: 'Local',
      transporte: 'stdio',
      comando: process.execPath,
      args: [arquivo],
    });
    await f.gestor.conectar(id);
    const r = await f.gestor.executar(
      'codex',
      'leitura_escrita',
      `${id}__get_item`,
      { id: '1' },
      new AbortController().signal,
    );
    assert.match(JSON.stringify(r), /OK_STDIO/);
    await f.gestor.alternar(id, false);
    assert.deepEqual(await f.gestor.ferramentas(), []);
    await f.gestor.alternar(id, true);
    assert.equal((await f.gestor.ferramentas()).length, 4);
    const segunda = new Integracoes(f.persistencia, f.segredos, f.portao, () => {});
    try {
      assert.equal((await segunda.ferramentas()).length, 4);
    } finally {
      await segunda.finalizar();
    }
    await f.gestor.remover(id);
    assert.equal(f.registros().length, 0);
  } finally {
    await f.gestor.finalizar();
    await tmp.limpar();
  }
});
test('timeout e redirecionamento nao perpetuam conexoes nem encaminham tokens', async () => {
  const servidor = await httpMcp({ delay: 500 });
  let c: ConexaoMcp | undefined;
  try {
    c = await conectarMcp(
      {
        id: 'x',
        nome: 'X',
        personalizada: true,
        transporte: 'http',
        url: servidor.url,
        autenticacao: 'nenhuma',
        ativa: true,
      },
      undefined,
      100,
    );
    await assert.rejects(c.listar());
  } finally {
    await c?.fechar();
    await servidor.fechar();
  }
  const destino = await httpMcp();
  const origem = await httpMcp({ redirect: destino.url });
  try {
    await assert.rejects(
      conectarMcp(
        {
          id: 'x',
          nome: 'X',
          personalizada: true,
          transporte: 'http',
          url: origem.url,
          autenticacao: 'token',
          ativa: true,
        },
        'ficticio',
        100,
      ),
    );
    assert.equal(destino.chamadas.length, 0);
  } finally {
    await origem.fechar();
    await destino.fechar();
  }
});
test('cancelamento, desativacao durante aprovacao, somente leitura e OAuth adiado', async () => {
  const servidor = await httpMcp();
  const f = fixture();
  try {
    const id = await f.gestor.adicionar({ nome: 'S', url: servidor.url });
    await f.gestor.conectar(id);
    const sinal = AbortSignal.abort();
    await assert.rejects(
      f.gestor.executar('codex', 'leitura_escrita', `${id}__get_item`, { id: '1' }, sinal),
    );
    assert.equal(servidor.chamadas.length, 0);
    await assert.rejects(f.gestor.conectar('figma'), /fase 0.4.0-b/);
    assert.throws(() => urlIntegracao('https://example.com/mcp?token=segredo'), /credenciais/);
    const r = f.registros()[0];
    r.somenteLeitura = true;
    await f.persistencia.salvar([r]);
    await assert.rejects(
      f.gestor.executar(
        'codex',
        'leitura_escrita',
        `${id}__update_item`,
        { id: '1' },
        new AbortController().signal,
      ),
      /somente para leitura/,
    );
  } finally {
    await f.gestor.finalizar();
    await servidor.fechar();
  }
});

test('SSE real envia o token na abertura e nas chamadas, sem revelar ao portal', async () => {
  const token = 'token-sse-ficticio';
  const sessoes = new Map<string, { transporte: SSEServerTransport; servidor: Server }>();
  const http = createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(403);
      res.end();
      return;
    }
    const u = new URL(req.url!, 'http://localhost');
    if (req.method === 'GET' && u.pathname === '/sse') {
      const servidor = new Server({ name: 'sse', version: '1' }, { capabilities: { tools: {} } });
      servidor.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
      servidor.setRequestHandler(CallToolRequestSchema, async () => ({
        content: [{ type: 'text', text: 'SSE_OK' }],
      }));
      const transporte = new SSEServerTransport('/mensagens', res);
      sessoes.set(transporte.sessionId, { transporte, servidor });
      res.on('close', () => {
        sessoes.delete(transporte.sessionId);
        void servidor.close();
      });
      await servidor.connect(transporte);
    } else if (req.method === 'POST' && u.pathname === '/mensagens') {
      const s = sessoes.get(u.searchParams.get('sessionId')!);
      if (s) await s.transporte.handlePostMessage(req, res);
      else {
        res.writeHead(404);
        res.end();
      }
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  const f = fixture();
  try {
    const id = await f.gestor.adicionar({
      nome: 'SSE',
      url: `http://127.0.0.1:${(http.address() as any).port}/sse`,
      transporte: 'sse',
      autenticacao: 'token',
    });
    await f.gestor.conectar(id, { token });
    const result = await f.gestor.executar(
      'claude',
      'leitura_escrita',
      `${id}__get_item`,
      { id: '1' },
      new AbortController().signal,
    );
    assert.match(JSON.stringify(result), /SSE_OK/);
    assert(!JSON.stringify(f.eventos).includes(token));
  } finally {
    await f.gestor.finalizar();
    await Promise.all([...sessoes.values()].map((s) => s.servidor.close()));
    http.closeAllConnections();
    await new Promise<void>((r) => http.close(() => r()));
  }
});
for (const nivel of ['manual', 'parcial', 'total'] as const)
  test(`integracoes passam pela matriz no nivel ${nivel}`, async () => {
    let efeitos = 0;
    const f = fixture(async () => ({
      listar: async () => tools,
      chamar: async () => {
        efeitos++;
        return { content: [{ type: 'text', text: 'OK' }] };
      },
      fechar: async () => {},
    }));
    f.config.nivel = nivel;
    try {
      const id = await f.gestor.adicionar({ nome: 'Matriz', url: 'https://example.invalid/mcp' });
      await f.gestor.conectar(id);
      for (const t of tools)
        await f.gestor.executar(
          'api',
          'leitura_escrita',
          `${id}__${t.name}`,
          { id: '1' },
          new AbortController().signal,
        );
      assert.equal(efeitos, 4);
      assert.equal(
        f.eventos.filter((e) => e.tipo === 'aprovacao').length,
        nivel === 'total' ? 1 : 4,
      );
    } finally {
      await f.gestor.finalizar();
    }
  });
test('desativar durante aprovacao impede efeito; inativa fica conectada para poder reativar', async () => {
  const servidor = await httpMcp();
  const f = fixture();
  try {
    const id = await f.gestor.adicionar({ nome: 'Estado', url: servidor.url });
    await f.gestor.conectar(id);
    f.antesDeAprovar(() => f.gestor.alternar(id, false));
    await assert.rejects(
      f.gestor.executar(
        'codex',
        'leitura_escrita',
        `${id}__delete_item`,
        { id: '1' },
        new AbortController().signal,
      ),
      /mudou/,
    );
    assert.equal(servidor.chamadas.length, 0);
    const estado = f.gestor.listar().find((i) => i.id === id)!;
    assert.equal(estado.estado, 'conectada');
    assert.equal(estado.ativa, false);
    await f.gestor.alternar(id, true);
    assert.equal((await f.gestor.ferramentas()).length, 4);
  } finally {
    await f.gestor.finalizar();
    await servidor.fechar();
  }
});
test('contrato v6: catalogo completo, estados conectando/conectada, valores e comando com espacos', async () => {
  const servidor = await httpMcp();
  const f = fixture();
  const eventos: any[] = [];
  try {
    const m = validarMensagem({ tipo: 'listarIntegracoes' });
    assert(await mensagemIntegracao(f.gestor, m, (e) => eventos.push(e)));
    assert.deepEqual(
      eventos[0].lista.map((i: any) => i.id),
      catalogo.map((i) => i.id),
    );
    await mensagemIntegracao(
      f.gestor,
      validarMensagem({
        tipo: 'adicionarIntegracaoPersonalizada',
        nome: 'Minha',
        transporte: 'http',
        endpoint: servidor.url,
        autenticacao: 'nenhuma',
      }),
      (e) => eventos.push(e),
    );
    const id = f.registros()[0].id;
    await mensagemIntegracao(
      f.gestor,
      validarMensagem({ tipo: 'conectarIntegracao', id, valores: {} }),
      (e) => eventos.push(e),
    );
    assert(f.eventos.some((e) => e.tipo === 'integracao' && e.integracao.estado === 'conectando'));
    assert(
      f.eventos.some(
        (e) =>
          e.tipo === 'integracao' &&
          e.integracao.estado === 'conectada' &&
          e.integracao.ferramentas.length === 4,
      ),
    );
    assert.deepEqual(separarComando('node "pasta com espacos/server.js" --flag'), {
      comando: 'node',
      args: ['pasta com espacos/server.js', '--flag'],
    });
    assert.throws(() =>
      validarMensagem({ tipo: 'conectarIntegracao', id, valores: { token: 'x' }, token: 'nao' }),
    );
    await assert.rejects(
      mensagemIntegracao(
        f.gestor,
        validarMensagem({ tipo: 'verSkill', nome: 'exemplo' }),
        () => {},
      ),
      /0.4.0-c/,
    );
    assert(
      catalogo
        .filter((c) => c.fase === 'b')
        .every(
          (c) =>
            f.gestor.listar().find((r) => r.id === c.id)?.mensagem ===
            'OAuth is planned for phase 0.4.0-b.',
        ),
    );
  } finally {
    await f.gestor.finalizar();
    await servidor.fechar();
  }
});
test('falha de persistencia restaura token anterior; tools/list rejeitada nao salva token', async () => {
  const f = fixture(async () => ({
    listar: async () => tools,
    chamar: async () => ({ content: [] }),
    fechar: async () => {},
  }));
  try {
    const id = await f.gestor.adicionar({
      nome: 'Cofre',
      url: 'https://example.invalid/mcp',
      autenticacao: 'token',
    });
    await f.gestor.conectar(id, { token: 'token-antes-ficticio' });
    f.persistencia.salvar = async () => {
      throw new Error('storage unavailable');
    };
    await assert.rejects(f.gestor.conectar(id, { token: 'token-depois-ficticio' }));
    assert.equal(f.valores.get(`fagulha.integracao.${id}.token`), 'token-antes-ficticio');
  } finally {
    await f.gestor.finalizar();
  }
  const outra = fixture(async () => ({
    listar: async () => {
      throw new Error('401');
    },
    chamar: async () => ({ content: [] }),
    fechar: async () => {},
  }));
  try {
    const id = await outra.gestor.adicionar({
      nome: 'Invalido',
      url: 'https://example.invalid/mcp',
      autenticacao: 'token',
    });
    await assert.rejects(outra.gestor.conectar(id, { token: 'nunca-salvar' }));
    assert.equal(outra.valores.size, 0);
  } finally {
    await outra.gestor.finalizar();
  }
});
test('conteudo de integracoes preserva imagens, texto nao confiavel, structuredContent e isError', () => {
  const c = conteudoResultado({
    conteudoMcp: [
      { type: 'text', text: 'UNTRUSTED' },
      { type: 'image', mimeType: 'image/png', data: 'ZmFrZQ==' },
    ],
    structuredContent: { value: 42 },
    isError: true,
  });
  assert.deepEqual(c.imagens, [{ mime: 'image/png', base64: 'ZmFrZQ==' }]);
  assert.match(c.texto, /UNTRUSTED/);
  assert.match(c.texto, /42/);
  assert.equal(c.erro, true);
  assert(!c.texto.includes('ZmFrZQ=='));
});
