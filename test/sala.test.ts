import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sala, mencoes, passagem, chaveSala } from '../src/core/sala';
import {
  agentePadrao,
  type Provedor,
  type EventosProvedor,
  type PedidoExecucao,
} from '../src/providers/tipos';
import { montarContexto } from '../src/core/contexto';
import { configuracaoPadrao } from '../src/core/configuracao';
import { banco, temporario } from './apoio';
function fake(
  id: string,
  responder: (p: PedidoExecucao, e: EventosProvedor, s: AbortSignal) => Promise<void>,
): Provedor {
  const agente = agentePadrao(id, id, 'cli', 'azul', id === 'gemini' ? ['ag', 'antigravity'] : []);
  agente.habilitado = true;
  agente.instalado = true;
  return {
    agente,
    detectar: async () => ({ instalado: true }),
    estadoLogin: async () => 'conectado',
    login: async () => {},
    executar: responder,
  };
}

test('aviso do provedor e mensagem neutra de sistema e agente permanece livre', async () => {
  const tmp = await temporario();
  try {
    const sala = new Sala('aviso', null, 'Sala', await banco(tmp.pasta));
    sala.registrar(
      fake('codex', async (_, ev) => {
        ev.sistema!(
          'O Codex ignorou configuracoes obsoletas no seu config.toml: features.rmcp_client, mcp. Isso nao afeta o Orquestrador.',
        );
        ev.fala('concluido');
      }),
    );
    await sala.iniciar();
    sala.enviar('@codex continue', []);
    await sala.esperar();
    const aviso = sala.mensagens.find((m) => m.texto.startsWith('O Codex ignorou'));
    assert.equal(aviso?.autor, 'sistema');
    assert.equal(aviso?.tipo, 'sistema');
    assert.equal(sala.agentes[0].estado, 'livre');
    assert(!sala.mensagens.some((m) => m.tipo === 'erro'));
  } finally {
    await tmp.limpar();
  }
});
test('mencoes aliases todos limites e ausencia de mencao', () => {
  const a = ['claude', 'codex', 'gemini'].map((id) => fake(id, async () => {}).agente);
  assert.deepEqual(mencoes('oi', a), []);
  assert.deepEqual(mencoes('@AG @antigravity @gemini @codex @codex', a), ['gemini', 'codex']);
  assert.deepEqual(mencoes('@todos', a), ['claude', 'codex', 'gemini']);
  assert.deepEqual(mencoes('email@codex @codex-extra @@claude', a), []);
  assert.deepEqual(passagem('claude', '@claude @codex', 5, 6, a), ['codex']);
  assert.deepEqual(passagem('claude', '@codex', 6, 6, a), []);
  a[1].habilitado = false;
  assert(!mencoes('@todos', a).includes('codex'));
  assert.notEqual(chaveSala(['a']), chaveSala(['b']));
  assert.equal(chaveSala(['b', 'a']), chaveSala(['a', 'b']));
});
test('fila serial, passagem automatica e reabertura persistente', async () => {
  const tmp = await temporario();
  try {
    const db = await banco(tmp.pasta),
      sala = new Sala('s', 'projeto', 'Projeto', db);
    const ordem: string[] = [];
    let simultaneos = 0,
      max = 0;
    for (const id of ['claude', 'codex'])
      sala.registrar(
        fake(id, async (p, e) => {
          simultaneos++;
          max = Math.max(max, simultaneos);
          ordem.push(id);
          e.sessao('sessao-' + id);
          await new Promise((r) => setTimeout(r, 5));
          e.fala(id === 'claude' ? '@codex revise' : 'revisado');
          simultaneos--;
        }),
      );
    await sala.iniciar();
    sala.enviar('mensagem sem mencao', []);
    assert.equal(ordem.length, 0);
    sala.enviar('@claude implemente', []);
    await sala.esperar();
    assert.deepEqual(ordem, ['claude', 'codex']);
    assert.equal(max, 1);
    const nova = new Sala('s', 'projeto', 'Projeto', db);
    for (const id of ['claude', 'codex']) nova.registrar(fake(id, async () => {}));
    await nova.iniciar();
    assert(nova.mensagens.some((m) => m.texto === 'revisado'));
    assert(nova.agentes.every((a) => a.temSessao));
    await nova.atualizarAgente('codex', { modo: 'leitura' });
    assert.equal(nova.provedores.get('codex')!.agente.temSessao, false);
    await assert.rejects(nova.configurar({ nivel: 'total' }, 'INCORRETO'));
    await nova.configurar({ nivel: 'total' }, 'ACEITO OS RISCOS');
    assert.equal(nova.config.nivel, 'total');
  } finally {
    await tmp.limpar();
  }
});
test('parar cancela atual, esvazia fila e nao passa palavra', async () => {
  const tmp = await temporario();
  try {
    const sala = new Sala('s', null, 'Sala', await banco(tmp.pasta));
    const ordem: string[] = [];
    let iniciado!: () => void;
    const pronto = new Promise<void>((r) => (iniciado = r));
    sala.registrar(
      fake('claude', async (p, e, s) => {
        ordem.push('claude');
        iniciado();
        await new Promise<void>((r) => s.addEventListener('abort', () => r(), { once: true }));
        e.fala('@codex');
      }),
    );
    sala.registrar(
      fake('codex', async () => {
        ordem.push('codex');
      }),
    );
    await sala.iniciar();
    sala.enviar('@todos', []);
    await pronto;
    sala.parar();
    await sala.esperar();
    assert.deepEqual(ordem, ['claude']);
    assert(sala.agentes.every((a) => a.estado === 'livre'));
  } finally {
    await tmp.limpar();
  }
});
test('contexto incremental inclui regras anexos e acoes', () => {
  const a = fake('codex', async () => {}).agente;
  const h = Array.from({ length: 100 }, (_, i) => ({
    id: String(i),
    sala: 's',
    quando: 'agora',
    autor: 'n',
    tipo: 'fala' as const,
    texto: `mensagem-${i}!`,
  }));
  const texto = montarContexto({
    agente: a,
    agentes: [a],
    config: configuracaoPadrao(),
    projeto: 'projeto',
    historico: h,
    visto: 98,
    sessao: 's',
    regras: ['regra do projeto'],
    anexos: ['anexo'],
    contextos: ['contexto'],
  });
  assert(texto.includes('mensagem-98!'));
  assert(!texto.includes('mensagem-97!'));
  assert(texto.includes('regra do projeto'));
  assert(texto.includes('anexo'));
  assert(texto.includes('contexto'));
});
test('fala publicada por MCP tambem passa palavra; nova mencao durante execucao volta a fila', async () => {
  const tmp = await temporario();
  try {
    const sala = new Sala('s', null, 'Sala', await banco(tmp.pasta));
    const ordem: string[] = [];
    sala.registrar(
      fake('claude', async () => {
        ordem.push('claude');
        sala.mensagem('claude', '@codex revise a publicacao MCP');
      }),
    );
    sala.registrar(
      fake('codex', async () => {
        ordem.push('codex');
      }),
    );
    await sala.iniciar();
    sala.enviar('@claude', []);
    await sala.esperar();
    assert.deepEqual(ordem, ['claude', 'codex']);
    let vezes = 0;
    sala.provedores.get('codex')!.executar = async (p, e) => {
      vezes++;
      e.sessao('sessao');
      if (vezes === 1) sala.enviar('@codex nova instrucao', []);
      else assert(p.prompt.includes('nova instrucao'));
    };
    sala.enviar('@codex', []);
    await sala.esperar();
    assert.equal(vezes, 2);
  } finally {
    await tmp.limpar();
  }
});
test('anexos pendentes restauram; envio carrega nome/tipo no contrato', async () => {
  const tmp = await temporario();
  try {
    const db = await banco(tmp.pasta),
      sala = new Sala('s', null, 'Sala', db);
    await sala.iniciar();
    await sala.adicionarAnexo({
      meta: { id: 'anexo', nome: 'arquivo.txt', tipo: 'texto', bytes: 2, tratamento: 'integral' },
      texto: 'oi',
    });
    const restaurada = new Sala('s', null, 'Sala', db);
    await restaurada.iniciar();
    assert.equal(restaurada.estado().anexosPendentes.length, 1);
    restaurada.enviar('mensagem', ['anexo']);
    await restaurada.esperar();
    assert.deepEqual(restaurada.mensagens.at(-1)!.anexos, [
      { id: 'anexo', nome: 'arquivo.txt', tipo: 'texto' },
    ]);
    const reaberta = new Sala('s', null, 'Sala', db);
    await reaberta.iniciar();
    assert.equal(reaberta.estado().anexosPendentes.length, 0);
  } finally {
    await tmp.limpar();
  }
});
