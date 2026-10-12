import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categorias, decidir, matriz } from '../src/permissions/matriz';
import { Portao } from '../src/permissions/portao';
import { configuracaoPadrao } from '../src/core/configuracao';
import type { DoHost, PedidoAprovacao, NivelPermissao } from '../src/shared/protocolo';
// Expectativas independentes: 12 categorias na ordem normativa.
const esperado = { manual: 'PPPPPPPPPPPPP', parcial: 'AAPPPPPPPPPPP', total: 'AAAAAAAAAAAAP' };
for (const nivel of ['manual', 'parcial', 'total'] as NivelPermissao[])
  for (const [indice, categoria] of categorias.entries())
    test(`${nivel} x ${categoria}`, () => {
      assert.equal(
        matriz[nivel][categoria],
        esperado[nivel][indice] === 'A' ? 'automatica' : 'aprovar',
      );
    });
for (const categoria of [
  'escrita_workspace',
  'escrita_maquina',
  'comando',
  'publicacao',
  'credencial',
  'destrutiva',
] as const)
  test(`modo leitura bloqueia ${categoria}`, () =>
    assert.equal(decidir('total', 'leitura', categoria), 'negada'));
for (const categoria of ['leitura_workspace', 'leitura_maquina'] as const)
  test(`modo escrita bloqueia ${categoria}`, () =>
    assert.equal(decidir('total', 'escrita', categoria), 'negada'));
test('aprovar sessao e exato; criticas nunca reutilizam aprovacao', async () => {
  const config = configuracaoPadrao();
  const auditoria: unknown[] = [];
  let prompts = 0;
  let portao: Portao;
  portao = new Portao(
    () => config,
    (e) => {
      if (e.tipo === 'aprovacao') {
        prompts++;
        queueMicrotask(() => portao.responder(e.pedido.id, 'aprovar_sessao'));
      }
    },
    async (r) => {
      auditoria.push(r);
    },
  );
  const acao = {
    agente: 'claude',
    modo: 'leitura_escrita' as const,
    categoria: 'escrita_workspace' as const,
    resumo: 'Escrever',
    detalhe: 'x.ts',
  };
  let efeitos = 0;
  await portao.executar(acao, async () => efeitos++);
  await portao.executar(acao, async () => efeitos++);
  assert.equal(prompts, 1);
  await portao.executar({ ...acao, detalhe: 'y.ts' }, async () => efeitos++);
  assert.equal(prompts, 2);
  config.nivel = 'total';
  for (let i = 0; i < 2; i++)
    await portao.executar({ ...acao, categoria: 'irreversivel_externo' }, async () => efeitos++);
  assert.equal(prompts, 4);
  assert.equal(efeitos, 5);
  assert.equal(auditoria.length, 5);
});
test('negar, expirar e cancelar impedem efeitos e sao auditados', async () => {
  const acao = {
    agente: 'codex',
    modo: 'leitura_escrita' as const,
    categoria: 'comando' as const,
    resumo: 'Comando',
    detalhe: 'git status',
  };
  let efeito = false;
  const registros: any[] = [];
  let portao: Portao;
  portao = new Portao(
    configuracaoPadrao,
    (e) => {
      if (e.tipo === 'aprovacao') queueMicrotask(() => portao.responder(e.pedido.id, 'negar'));
    },
    async (r) => {
      registros.push(r);
    },
    20,
  );
  await assert.rejects(
    portao.executar(acao, async () => {
      efeito = true;
    }),
  );
  assert.equal(registros[0].decisao, 'negar');
  const expira = new Portao(
    configuracaoPadrao,
    () => {},
    async (r) => {
      registros.push(r);
    },
    10,
  );
  await assert.rejects(
    expira.executar(acao, async () => {
      efeito = true;
    }),
  );
  assert.equal(registros[1].decisao, 'expirada');
  const controle = new AbortController();
  const cancela = new Portao(
    configuracaoPadrao,
    (e) => {
      if (e.tipo === 'aprovacao') queueMicrotask(() => controle.abort());
    },
    async (r) => {
      registros.push(r);
    },
  );
  await assert.rejects(
    cancela.executar(
      acao,
      async () => {
        efeito = true;
      },
      controle.signal,
    ),
  );
  assert.equal(efeito, false);
  assert.equal(cancela.pendentes.size, 0);
});
test('acao automatica informa antes de executar', async () => {
  const config = configuracaoPadrao();
  config.nivel = 'total';
  const eventos: DoHost[] = [];
  const portao = new Portao(
    () => config,
    (e) => eventos.push(e),
    async () => {},
  );
  await portao.executar(
    {
      agente: 'codex',
      modo: 'leitura_escrita',
      categoria: 'leitura_workspace',
      resumo: 'Ler arquivo',
      detalhe: 'x.ts',
    },
    async () => assert.equal(eventos[0].tipo, 'mensagem'),
  );
});
