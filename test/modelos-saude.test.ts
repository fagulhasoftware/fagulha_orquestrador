import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sala } from '../src/core/sala';
import {
  agentePadrao,
  type Provedor,
  type PedidoExecucao,
  type EventosProvedor,
} from '../src/providers/tipos';
import { argumentosModelo, lerEvento } from '../src/providers/cli';
import { modelosAntigravity, erroSelecaoModelo } from '../src/providers/modelos';
import { SaudeAgente, testeAritmetico } from '../src/core/saude';
import { ProvedorApi } from '../src/providers/api';
import { banco, temporario } from './apoio';
import { createServer } from 'node:http';
import type { Mensagem } from '../src/shared/protocolo';
import { protegerPreferenciasVibe } from '../src/providers/perfil-mistral';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { substituirAtomico } from '../src/storage/sqlite';

function fake(id: string, executar: Provedor['executar']): Provedor {
  return {
    agente: agentePadrao(id, id, 'cli', 'azul'),
    executar,
    detectar: async () => ({ instalado: true }),
    estadoLogin: async () => 'conectado',
    login: async () => {},
    listarModelos: async () => ({
      origem: 'runtime',
      modelos: [
        { id: 'fixture-a', nome: 'Fixture A', esforcos: ['low', 'high'] },
        { id: 'fixture-b', nome: 'Fixture B' },
      ],
    }),
  };
}
const eventos = (): EventosProvedor => ({
  sessao: () => {},
  fala: () => {},
  parcial: () => {},
  acao: () => {},
  erro: () => {},
});

test('flags reais de modelo/esforco, parser agy e diagnostico de quota', () => {
  assert.deepEqual(argumentosModelo('codex', 'fixture-a', 'high'), [
    '--model',
    'fixture-a',
    '-c',
    'model_reasoning_effort="high"',
  ]);
  for (const id of ['claude', 'antigravity'] as const)
    assert.deepEqual(argumentosModelo(id, 'fixture-a', 'low'), [
      '--model',
      'fixture-a',
      '--effort',
      'low',
    ]);
  assert.deepEqual(argumentosModelo('gemini', 'fixture-b'), ['--model', 'fixture-b']);
  assert.deepEqual(argumentosModelo('codex'), []);
  assert.deepEqual(modelosAntigravity('Fetching...\nfixture-a\tFixture A\n'), [
    { id: 'fixture-a', nome: 'Fixture A' },
  ]);
  assert(erroSelecaoModelo('RESOURCE_EXHAUSTED: quota exceeded'));
  assert(!erroSelecaoModelo('ECONNRESET disconnected'));
  const erros: string[] = [];
  lerEvento(
    'antigravity',
    { event: 'result', result: { status: 'RESOURCE_EXHAUSTED', message: 'quota exceeded' } },
    { ...eventos(), erro: (t) => erros.push(t) },
  );
  assert.deepEqual(erros, ['quota exceeded']);
});

test('persistencia repete somente renomeacao com bloqueio transitorio, com limite', async () => {
  let tentativas = 0;
  await substituirAtomico('origem', 'destino', async () => {
    if (++tentativas < 3) throw Object.assign(new Error('ocupado'), { code: 'EPERM' });
  });
  assert.equal(tentativas, 3);
  tentativas = 0;
  await assert.rejects(
    substituirAtomico('origem', 'destino', async () => {
      tentativas++;
      throw Object.assign(new Error('cheio'), { code: 'ENOSPC' });
    }),
    /cheio/,
  );
  assert.equal(tentativas, 1);
});

test('modelo por agente persiste, valida catalogo e muda somente no proximo turno', async () => {
  const tmp = await temporario();
  try {
    const db = await banco(tmp.pasta),
      s = new Sala('s', null, 'Sala', db),
      pedidos: PedidoExecucao[] = [];
    let iniciar!: () => void, liberar!: () => void;
    const pronto = new Promise<void>((r) => (iniciar = r)),
      aguardar = new Promise<void>((r) => (liberar = r));
    const p = fake('codex', async (p, e) => {
      pedidos.push(p);
      e.sessao('s-' + pedidos.length);
      if (pedidos.length === 1) {
        iniciar();
        await aguardar;
      }
      e.fala('resposta ' + pedidos.length);
    });
    s.registrar(p);
    s.registrar(fake('claude', async () => {}));
    await s.iniciar();
    await s.atualizarModelos('codex');
    await s.selecionarModelo('codex', 'fixture-a', 'high');
    s.enviar('@codex primeira', []);
    await pronto;
    await s.selecionarModelo('codex', 'fixture-b');
    assert.equal(p.agente.estado, 'trabalhando');
    assert.equal(pedidos[0].modelo, 'fixture-a');
    liberar();
    await s.esperar();
    s.enviar('@codex segunda', []);
    await s.esperar();
    assert.equal(pedidos[1].modelo, 'fixture-b');
    assert.equal(pedidos[1].sessao, undefined);
    assert.equal(s.agentes[1].modelo, undefined);
    assert(pedidos[1].contextoSeq! > pedidos[0].contextoSeq!);
    assert.notEqual(pedidos[0].requisicaoId, pedidos[1].requisicaoId);
    const nova = new Sala('s', null, 'Sala', db);
    nova.registrar(fake('codex', async () => {}));
    await nova.iniciar();
    assert.equal(nova.agentes[0].modelo, 'fixture-b');
    await assert.rejects(s.selecionarModelo('codex', 'inventado'), /nao anunciado/);
    await assert.rejects(s.selecionarModelo('codex', 'fixture-b', 'high'), /nao suportado/);
    await s.selecionarModelo('codex', '');
    assert.equal(s.agentes[0].modelo, '');
    await s.esperar();
    await nova.esperar();
  } finally {
    await tmp.limpar();
  }
});

for (const via of ['throw', 'evento'] as const)
  test(`modelo sem cota: fallback padrao uma vez (${via}), sem trocar conta`, async () => {
    const tmp = await temporario();
    try {
      const s = new Sala('s', null, 'Sala', await banco(tmp.pasta)),
        pedidos: PedidoExecucao[] = [];
      s.registrar(
        fake('antigravity', async (p, e) => {
          pedidos.push(p);
          e.sessao('fixture');
          if (p.modelo) {
            if (via === 'throw') throw Error('model unavailable: quota exceeded');
            e.erro('RESOURCE_EXHAUSTED quota');
          } else e.fala('recuperado');
        }),
      );
      await s.iniciar();
      await s.selecionarModelo('antigravity', 'fixture-a');
      s.enviar('@antigravity responda', []);
      await s.esperar();
      assert.equal(pedidos.length, 2);
      assert.equal(pedidos[1].modelo, undefined);
      assert.equal(pedidos[1].sessao, undefined);
      assert(s.mensagens.some((m) => m.texto.includes('Voltando para Padrao')));
      assert.equal(s.agentes[0].estado, 'livre');
    } finally {
      await tmp.limpar();
    }
  });

test('Mistral: stream e final iguais geram uma unica mensagem persistida com ID e sequencia', async () => {
  const tmp = await temporario();
  try {
    const db = await banco(tmp.pasta),
      s = new Sala('s', null, 'Sala', db);
    s.registrar(
      fake('mistral', async (_, e) => {
        e.parcial('2');
        e.fala('2');
      }),
    );
    await s.iniciar();
    s.enviar('@mistral 1+1', []);
    await s.esperar();
    const respostas = (await db.listar<Mensagem>('mensagens', s.chat.id)).filter(
      (m) => m.autor === 'mistral' && m.tipo === 'fala',
    );
    assert.equal(respostas.length, 1);
    assert.equal(respostas[0].texto, '2');
    assert(respostas[0].requisicaoId);
    assert(respostas[0].contextoSeq);
  } finally {
    await tmp.limpar();
  }
});

test('resposta incorreta ao teste reinicia sessao, descarta 22 e responde com contexto atual', async () => {
  const tmp = await temporario();
  try {
    const s = new Sala('s', null, 'Sala', await banco(tmp.pasta)),
      pedidos: PedidoExecucao[] = [];
    s.registrar(
      fake('mistral', async (p, e) => {
        pedidos.push(p);
        e.sessao('old');
        e.fala(pedidos.length === 1 ? '22' : '2');
      }),
    );
    await s.iniciar();
    s.enviar('@mistral 1+1', []);
    await s.esperar();
    assert.equal(pedidos.length, 2);
    assert.equal(pedidos[1].sessao, undefined);
    assert(pedidos[1].prompt.includes('1+1'));
    assert(!s.mensagens.some((m) => m.tipo === 'fala' && m.texto === '22'));
    assert(s.mensagens.some((m) => m.texto.includes('travado')));
    await s.reiniciarContexto('mistral');
    assert(!s.agentes[0].temSessao);
    await s.esperar();
  } finally {
    await tmp.limpar();
  }
});

test('recuperacao tem limite e deixa agente travado se continuar falhando', async () => {
  const tmp = await temporario();
  try {
    const s = new Sala('s', null, 'Sala', await banco(tmp.pasta));
    let vezes = 0;
    s.registrar(
      fake('mistral', async (_, e) => {
        vezes++;
        e.fala('22');
      }),
    );
    await s.iniciar();
    s.enviar('@mistral 1+1', []);
    await s.esperar();
    assert.equal(vezes, 2);
    assert.equal(s.agentes[0].estado, 'travado');
  } finally {
    await tmp.limpar();
  }
});

test('saida atrasada apos nova pergunta e cancelamento nao contamina o chat', async () => {
  const tmp = await temporario();
  try {
    const s = new Sala('s', null, 'Sala', await banco(tmp.pasta)),
      pedidos: PedidoExecucao[] = [];
    let iniciar!: () => void;
    const pronto = new Promise<void>((r) => (iniciar = r));
    s.registrar(
      fake('mistral', async (p, e, sinal) => {
        pedidos.push(p);
        if (pedidos.length === 1) {
          iniciar();
          await new Promise<void>((r) =>
            sinal.addEventListener('abort', () => r(), { once: true }),
          );
          e.fala('ANTIGA');
          e.acao('ANTIGA ACAO');
        } else e.fala('atual');
      }),
    );
    await s.iniciar();
    s.enviar('@mistral antiga', []);
    await pronto;
    s.enviar('@mistral atual', []);
    await s.esperar();
    assert.equal(pedidos.length, 2);
    assert(pedidos[1].prompt.includes('@mistral atual'));
    assert(!s.mensagens.some((m) => m.texto.startsWith('ANTIGA')));
  } finally {
    await tmp.limpar();
  }
});

test('health check distingue repeticao entre perguntas e nao julga semantica geral', () => {
  const s = new SaudeAgente();
  assert.equal(s.verificar('a', 'pergunta um', 'resposta padrao'), undefined);
  assert.match(s.verificar('a', 'pergunta dois', 'resposta padrao')!, /repetiu/);
  assert.equal(testeAritmetico('@a 1+1', '1+1 = 22'), false);
  assert.equal(testeAritmetico('@a 1+1', '2'), true);
  assert.equal(testeAritmetico('explique aritmetica', '22'), undefined);
});

test('reinicio manual de um agente preserva a fila dos outros participantes', async () => {
  const tmp = await temporario();
  try {
    const s = new Sala('s', null, 'Sala', await banco(tmp.pasta));
    let iniciou!: () => void,
      outro = 0;
    const pronto = new Promise<void>((r) => (iniciou = r));
    s.registrar(
      fake('mistral', async (_, e, sinal) => {
        iniciou();
        await new Promise<void>((r) => sinal.addEventListener('abort', () => r(), { once: true }));
        e.fala('antiga');
      }),
    );
    s.registrar(
      fake('codex', async (_, e) => {
        outro++;
        e.fala('atual');
      }),
    );
    await s.iniciar();
    s.enviar('@todos teste', []);
    await pronto;
    await s.reiniciarContexto('mistral');
    await s.esperar();
    assert.equal(outro, 1);
    assert(!s.mensagens.some((m) => m.texto === 'antiga'));
    assert(!s.agentes[0].temSessao);
  } finally {
    await tmp.limpar();
  }
});

test('erro apos receber prompt nao avanca cursor nem retoma sessao possivelmente incompleta', async () => {
  const tmp = await temporario();
  try {
    const s = new Sala('s', null, 'Sala', await banco(tmp.pasta)),
      pedidos: PedidoExecucao[] = [];
    s.registrar(
      fake('mistral', async (p, e) => {
        pedidos.push(p);
        e.sessao('fixture');
        if (pedidos.length === 1) throw Error('falha de transporte');
        e.fala('resposta atual');
      }),
    );
    await s.iniciar();
    s.enviar('@mistral primeira importante', []);
    await s.esperar();
    assert(!s.agentes[0].temSessao);
    s.enviar('@mistral segunda', []);
    await s.esperar();
    assert.equal(pedidos[1].sessao, undefined);
    assert(pedidos[1].prompt.includes('primeira importante'));
    assert(pedidos[1].prompt.includes('segunda'));
  } finally {
    await tmp.limpar();
  }
});

test('mensagem de outra janela invalida resposta antiga antes de persistir', async () => {
  const tmp = await temporario();
  try {
    const db = await banco(tmp.pasta),
      s = new Sala('s', null, 'Sala', db),
      pedidos: PedidoExecucao[] = [];
    s.registrar(
      fake('mistral', async (p, e) => {
        pedidos.push(p);
        if (pedidos.length === 1) {
          await db.gravarMensagem(
            s.chat.id,
            {
              id: 'outra-janela',
              sala: s.id,
              quando: new Date().toISOString(),
              autor: s.config.nick,
              tipo: 'fala',
              texto: '@mistral pergunta ATUAL de outra janela',
            },
            true,
          );
          e.fala('ANTIGA');
        } else e.fala('atual');
      }),
    );
    await s.iniciar();
    s.enviar('@mistral primeira', []);
    await s.esperar();
    assert.equal(pedidos.length, 2);
    assert(pedidos[1].prompt.includes('ATUAL de outra janela'));
    assert(!s.mensagens.some((m) => m.texto === 'ANTIGA'));
  } finally {
    await tmp.limpar();
  }
});

test('falha tambem no padrao encerra tentativa, preserva diagnostico e nao faz loop', async () => {
  const tmp = await temporario();
  try {
    const s = new Sala('s', null, 'Sala', await banco(tmp.pasta));
    let chamadas = 0;
    s.registrar(
      fake('antigravity', async () => {
        chamadas++;
        throw Error('quota exceeded model unavailable');
      }),
    );
    await s.iniciar();
    await s.selecionarModelo('antigravity', 'fixture-a');
    s.enviar('@antigravity teste', []);
    await s.esperar();
    assert.equal(chamadas, 2);
    assert.equal(s.agentes[0].estado, 'erro');
    assert.equal(s.agentes[0].modelo, '');
  } finally {
    await tmp.limpar();
  }
});

test('sequencias de contexto sao monotonicas entre instancias do storage', async () => {
  const tmp = await temporario();
  try {
    const a = await banco(tmp.pasta),
      s = new Sala('s', null, 'Sala', a);
    await s.iniciar();
    const b = await banco(tmp.pasta);
    const seq = await Promise.all([
      a.proximaSequencia(s.chat.id),
      b.proximaSequencia(s.chat.id),
      a.proximaSequencia(s.chat.id),
    ]);
    assert.deepEqual([...seq].sort(), [1, 2, 3]);
    await s.esperar();
  } finally {
    await tmp.limpar();
  }
});

test('preferencias nativas Mistral sao restauradas apos selecao e aborto sem sobrescrever edicao externa', async () => {
  const tmp = await temporario();
  try {
    const arquivo = join(tmp.pasta, 'config.toml'),
      original = 'active_model = "padrao-fixture"\n';
    await writeFile(arquivo, original);
    const controle = new AbortController();
    const p = await protegerPreferenciasVibe(tmp.pasta, controle.signal);
    await writeFile(arquivo, 'active_model = "selecionado-fixture"\n');
    await p.marcar();
    controle.abort();
    assert.equal(await p.restaurar(), true);
    assert.equal(await readFile(arquivo, 'utf8'), original);
    const q = await protegerPreferenciasVibe(tmp.pasta, new AbortController().signal);
    await writeFile(arquivo, 'active_model = "selecionado-fixture"\n');
    await q.marcar();
    await writeFile(arquivo, 'active_model = "edicao-externa"\n');
    assert.equal(await q.restaurar(), false);
    assert.equal(await readFile(arquivo, 'utf8'), 'active_model = "edicao-externa"\n');
    const r = await protegerPreferenciasVibe(tmp.pasta, new AbortController().signal);
    const abortado = new AbortController();
    abortado.abort();
    await assert.rejects(protegerPreferenciasVibe(tmp.pasta, abortado.signal), /interrompida/);
    await r.restaurar();
  } finally {
    await tmp.limpar();
  }
});

test('timeout de modelo escolhido volta ao padrao uma vez', async () => {
  const tmp = await temporario();
  try {
    const s = new Sala('s', null, 'Sala', await banco(tmp.pasta)),
      pedidos: PedidoExecucao[] = [];
    s.registrar(
      fake('mistral', async (p, e, sinal) => {
        pedidos.push(p);
        if (p.modelo) {
          s.config.timeoutMinutos = 0;
          await new Promise<void>((r) =>
            sinal.addEventListener('abort', () => r(), { once: true }),
          );
          throw Error('Execucao interrompida.');
        } else e.fala('2');
      }),
    );
    await s.iniciar();
    await s.selecionarModelo('mistral', 'fixture-a');
    s.enviar('@mistral 1+1', []);
    await s.esperar();
    assert.equal(pedidos.length, 2);
    assert.equal(pedidos[1].modelo, undefined);
    assert.equal(s.agentes[0].estado, 'livre');
  } finally {
    await tmp.limpar();
  }
});

test('Ollama lista modelos reais e transmite a selecao no corpo HTTP', async () => {
  const bodies: any[] = [];
  const server = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/tags') {
      res.end(
        JSON.stringify({ models: [{ name: 'fixture-local' }, { name: 'fixture-embedding' }] }),
      );
      return;
    }
    let b = '';
    for await (const c of req) b += c;
    if (req.url === '/api/show') {
      res.end(
        JSON.stringify({
          capabilities: [JSON.parse(b).model === 'fixture-local' ? 'completion' : 'embedding'],
        }),
      );
      return;
    }
    bodies.push(JSON.parse(b));
    res.end(JSON.stringify({ message: { content: 'ok' } }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  try {
    const baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
    const p = new ProvedorApi(
      'ollama',
      { get: async () => undefined, store: async () => {} },
      () => ({ baseUrl, modelo: 'fixture-default' }),
    );
    const catalogo = await p.listarModelos();
    assert.deepEqual(catalogo.modelos, [{ id: 'fixture-local', nome: 'fixture-local' }]);
    await p.executar(
      {
        prompt: 'teste',
        projeto: '.',
        modo: 'leitura_escrita',
        nivel: 'total',
        modelo: 'fixture-local',
        ponte: { url: '', token: '', servidor: '', diretorio: '' },
      },
      eventos(),
      new AbortController().signal,
    );
    assert.equal(bodies[0].model, 'fixture-local');
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('API compativel nao oferece modelos sem capacidade de chat, exceto lista configurada', async () => {
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        data: [
          { id: 'fixture-chat', capabilities: { completion_chat: true } },
          { id: 'fixture-embedding', capabilities: { completion_chat: false } },
          { id: 'fixture-desconhecido' },
          { id: 'fixture-configurado' },
        ],
      }),
    );
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  try {
    const baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
    const p = new ProvedorApi(
      'openai-compativel',
      { get: async () => 'fixture-credential-model-discovery', store: async () => {} },
      () => ({ baseUrl, modelos: ['fixture-configurado'] }),
    );
    const c = await p.listarModelos();
    assert.deepEqual(
      c.modelos.map((m) => m.id),
      ['fixture-chat', 'fixture-configurado'],
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
