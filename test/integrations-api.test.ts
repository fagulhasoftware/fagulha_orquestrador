import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { ProvedorApi, type ApiId } from '../src/providers/api';
import { Integracoes } from '../src/integrations/gestor';
import type { RegistroIntegracao } from '../src/integrations/tipos';
import { Portao } from '../src/permissions/portao';
import { configuracaoPadrao } from '../src/core/configuracao';
import { banco, temporario } from './apoio';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

for (const id of ['openai-api', 'anthropic', 'gemini-api', 'ollama'] as ApiId[])
  test(`${id}: descoberta dinamica e resposta com imagem passam pelo mesmo portal`, async () => {
    let chamadas = 0;
    const pedidos: any[] = [];
    let efeitos = 0;
    const config = configuracaoPadrao();
    config.nivel = 'total';
    const portao = new Portao(
      () => config,
      () => {},
      async () => {},
    );
    let registros: RegistroIntegracao[] = [];
    const gestor = new Integracoes(
      {
        ler: async () => registros,
        salvar: async (r) => {
          registros = r;
        },
      },
      { get: async () => undefined, store: async () => {} },
      portao,
      () => {},
      async () => ({
        listar: async () => [
          { name: 'get_image', inputSchema: { type: 'object', properties: {} } },
        ],
        chamar: async () => {
          efeitos++;
          return {
            content: [
              { type: 'text', text: 'EXTERNAL_IMAGE' },
              { type: 'image', mimeType: 'image/png', data: 'ZmFrZQ==' },
            ],
            structuredContent: { value: 42 },
          };
        },
        fechar: async () => {},
      }),
    );
    const custom = await gestor.adicionar({ nome: 'Imagem', url: 'https://example.invalid/mcp' });
    await gestor.conectar(custom);
    const nome = `${custom}__get_image`;
    const http = createServer(async (req, res) => {
      let s = '';
      for await (const b of req) s += b;
      const pedido = JSON.parse(s);
      pedidos.push(pedido);
      chamadas++;
      let resposta: any;
      if (id === 'anthropic')
        resposta = {
          content:
            chamadas === 1
              ? [{ type: 'tool_use', id: 't1', name: nome, input: {} }]
              : [{ type: 'text', text: 'CONCLUIDO' }],
        };
      else if (id === 'gemini-api')
        resposta = {
          candidates: [
            {
              content: {
                parts:
                  chamadas === 1
                    ? [{ functionCall: { name: nome, args: {} } }]
                    : [{ text: 'CONCLUIDO' }],
              },
            },
          ],
        };
      else {
        const message =
          chamadas === 1
            ? {
                role: 'assistant',
                content: '',
                tool_calls: [
                  { id: 't1', type: 'function', function: { name: nome, arguments: '{}' } },
                ],
              }
            : { role: 'assistant', content: 'CONCLUIDO' };
        resposta = id === 'ollama' ? { message } : { choices: [{ message }] };
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(resposta));
    });
    await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
    const falas: string[] = [];
    try {
      const prov = new ProvedorApi(
        id,
        { get: async () => 'chave-ficticia-api', store: async () => {} },
        () => ({ modelo: 'simulado', baseUrl: `http://127.0.0.1:${(http.address() as any).port}` }),
        async () => undefined,
      );
      await prov.executar(
        {
          prompt: 'Teste',
          projeto: '.',
          modo: 'leitura_escrita',
          nivel: 'total',
          ponte: { url: '', token: '', servidor: '', diretorio: '' },
          ferramentas: await gestor.ferramentas(),
          ferramenta: (n, a) =>
            gestor.executar(id, 'leitura_escrita', n, a, new AbortController().signal),
        },
        {
          fala: (t) => falas.push(t),
          acao: () => {},
          erro: () => {},
          parcial: () => {},
          sessao: () => {},
        },
        new AbortController().signal,
      );
      assert.equal(efeitos, 1);
      assert.equal(chamadas, 2);
      assert.deepEqual(falas, ['CONCLUIDO']);
      assert(JSON.stringify(pedidos[0].tools).includes(nome));
      assert(!JSON.stringify(pedidos[0].tools).includes('sala_ler'));
      const texto = JSON.stringify(pedidos[1]);
      assert.match(texto, /EXTERNAL_IMAGE/);
      assert.match(texto, /42/);
      assert.match(texto, /ZmFrZQ==/);
      assert.match(texto, /NAO CONFIAVEL/);
    } finally {
      await gestor.finalizar();
      http.closeAllConnections();
      await new Promise<void>((r) => http.close(() => r()));
    }
  });

test('persistencia SQLite guarda somente configuracao; token permanece no cofre', async () => {
  const tmp = await temporario();
  const db = await banco(tmp.pasta);
  const token = 'token-de-fixture-que-nao-pode-estar-no-sqlite';
  const segredos = new Map<string, string>();
  const config = configuracaoPadrao();
  config.nivel = 'total';
  const gestor = new Integracoes(
    {
      ler: async () => (await db.obter<RegistroIntegracao[]>('globais', '', 'integracoes')) ?? [],
      salvar: (r) => db.gravar('globais', '', 'integracoes', r),
    },
    {
      get: async (k) => segredos.get(k),
      store: async (k, v) => {
        segredos.set(k, v);
      },
      delete: async (k) => {
        segredos.delete(k);
      },
    },
    new Portao(
      () => config,
      () => {},
      async () => {},
    ),
    () => {},
    async () => ({
      listar: async () => [],
      chamar: async () => ({ content: [] }),
      fechar: async () => {},
    }),
  );
  try {
    const id = await gestor.adicionar({
      nome: 'Dados',
      url: 'https://example.invalid/mcp',
      autenticacao: 'token',
    });
    await gestor.conectar(id, { token });
    assert.equal(segredos.size, 1);
    assert(!(await readFile(join(tmp.pasta, 'dados.sqlite'))).includes(Buffer.from(token)));
    assert(!JSON.stringify(await db.obter('globais', '', 'integracoes')).includes(token));
    await gestor.desconectar(id);
    assert.equal(segredos.size, 0);
  } finally {
    await gestor.finalizar();
    await db.finalizar();
    await tmp.limpar();
  }
});
