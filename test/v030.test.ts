import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'node:http';
import initSqlJs from 'sql.js';
import JSZip from 'jszip';
import { banco, temporario } from './apoio';
import { Sala } from '../src/core/sala';
import { Perguntas, esquemaPergunta, type RegistroPergunta } from '../src/core/perguntas';
import { agentePadrao, type Provedor, type EventosProvedor } from '../src/providers/tipos';
import { lerEvento } from '../src/providers/cli';
import { ExecutorFerramentas } from '../src/mcp/executor';
import { validarMensagem } from '../src/core/protocolo';
import { validarArgumentos } from '../src/mcp/ferramentas';
import { protegerSegredo } from '../src/core/seguranca';
import { VozNuvem, segredoTts, wavPcm } from '../src/voice/nuvem';
import { TurnosVoz, trechoAutomatico } from '../src/voice/turnos';
import { Leitor, argumentosPiper } from '../src/voice/leitor';
import { estadoInicialVoz, padraoVoz } from '../src/voice/configuracao';
import { extrairBinarios } from '../src/voice/instalador';
import { artefato, VOZES_COMERCIAIS } from '../src/voice/catalogo';
import { VozLocal } from '../src/voice/controlador';
import { ProvedorApi, type ApiId } from '../src/providers/api';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { PonteHttp } from '../src/mcp/ponte';
import type { DoHost, Mensagem } from '../src/shared/protocolo';
import type { ConfigGlobal } from '../src/storage/global';

const pergunta = {
  titulo: 'Escolha o formato',
  perguntas: [
    {
      id: 'formato',
      pergunta: 'Qual formato?',
      opcoes: [{ rotulo: 'Texto', recomendada: true }, { rotulo: 'Tabela' }],
      permiteTexto: true,
    },
  ],
};

test('perguntar_usuario atravessa servidor MCP stdio empacotado, espera UI e retorna JSON sem aprovacao', async () => {
  const tmp = await temporario();
  const sala = new Sala('s', null, 'Sala', await banco(tmp.pasta));
  sala.registrar(fake());
  await sala.iniciar();
  const eventos: DoHost[] = [];
  sala.observar((e) => eventos.push(e));
  const executor = new ExecutorFerramentas(sala, [], async () => {});
  const ponte = new PonteHttp((id, nome, args, sinal) => executor.executar(id, nome, args, sinal));
  await ponte.iniciar();
  const capacidade = ponte.criar('claude', new AbortController().signal);
  const cliente = new Client({ name: 'teste-v5', version: '1' }, {});
  const transporte = new StdioClientTransport({
    command: process.execPath,
    args: [join(process.cwd(), 'dist/mcp-servidor.js')],
    env: {
      ORQUESTRA_BRIDGE_URL: capacidade.url,
      ORQUESTRA_BRIDGE_TOKEN: capacidade.token,
      ELECTRON_RUN_AS_NODE: '1',
    },
    stderr: 'pipe',
  });
  try {
    await cliente.connect(transporte);
    const lista = await cliente.listTools();
    assert(lista.tools.some((t) => t.name === 'perguntar_usuario'));
    const tarefa = cliente.callTool({ name: 'perguntar_usuario', arguments: pergunta });
    await esperar(() => sala.perguntas.pendentes.size === 1);
    assert.equal(sala.agentes[0].fase?.tipo, 'aguardando_resposta');
    const m = validarMensagem({
      tipo: 'responderPergunta',
      id: [...sala.perguntas.pendentes.keys()][0],
      respostas: resposta,
    });
    assert(m.tipo === 'responderPergunta');
    sala.perguntas.responder(m.id, m.respostas);
    const resultado = await tarefa;
    assert.equal(resultado.isError, undefined);
    assert.deepEqual(JSON.parse((resultado.content as any[])[0].text), {
      situacao: 'respondida',
      respostas: resposta,
    });
    assert(!eventos.some((e) => e.tipo === 'aprovacao'));
    assert(!JSON.stringify(eventos).includes(capacidade.token));
    await sala.esperar();
  } finally {
    sala.parar();
    capacidade.revogar();
    await cliente.close();
    await ponte.finalizar();
    await sala.esperar();
    await tmp.limpar();
  }
});
const resposta = [{ id: 'formato', opcoes: ['Texto'] }];
const pausa = () => new Promise((r) => setTimeout(r, 5));
async function esperar(fn: () => boolean) {
  const limite = Date.now() + 3000;
  while (!fn()) {
    if (Date.now() > limite) assert.fail('Condicao nao atingida');
    await pausa();
  }
}
function fake(executar: Provedor['executar'] = async (_p, e) => e.fala('Terminei.')): Provedor {
  const agente = agentePadrao('claude', 'Claude', 'cli', 'azul');
  agente.instalado = true;
  agente.habilitado = true;
  return {
    agente,
    executar,
    detectar: async () => ({ instalado: true }),
    estadoLogin: async () => 'conectado',
    login: async () => {},
  };
}

test('pergunta valida cardinalidades, unicidade e respostas sem confiar no webview', async () => {
  const registros: RegistroPergunta[] = [];
  const eventos: DoHost[] = [];
  const p = new Perguntas(
    (e) => eventos.push(e),
    async (r) => {
      registros.push(r);
    },
    () => {},
    1000,
  );
  for (const entrada of [
    { perguntas: [] },
    { ...pergunta, perguntas: [{ ...pergunta.perguntas[0], opcoes: [{ rotulo: 'Uma' }] }] },
    { ...pergunta, perguntas: [...pergunta.perguntas, ...pergunta.perguntas] },
    { ...pergunta, extra: true },
  ])
    assert.throws(() => esquemaPergunta.parse(entrada));
  assert.deepEqual(validarArgumentos('perguntar_usuario', pergunta), pergunta);
  const tarefa = p.perguntar('claude', pergunta, new AbortController().signal);
  await esperar(() => p.pendentes.size === 1);
  const id = [...p.pendentes.keys()][0];
  assert(!eventos.some((e) => e.tipo === 'aprovacao'));
  for (const r of [
    [],
    [{ id: 'outro', opcoes: ['Texto'] }],
    [{ id: 'formato', opcoes: ['Inventado'] }],
    [{ id: 'formato', opcoes: ['Texto', 'Tabela'] }],
    [{ id: 'formato', opcoes: ['Texto'], texto: 'Outra' }],
  ])
    assert.throws(() => p.responder(id, r));
  p.responder(id, resposta);
  assert.deepEqual(await tarefa, { situacao: 'respondida', respostas: resposta });
  assert.equal(registros.at(-1)?.situacao, 'respondida');
  assert.equal(p.pendentes.size, 0);
});
for (const caso of ['cancelar', 'parar', 'expirar'] as const)
  test(`pergunta desbloqueia ao ${caso} e persiste resultado`, async () => {
    const registros: RegistroPergunta[] = [];
    const controle = new AbortController();
    const p = new Perguntas(
      () => {},
      async (r) => {
        registros.push(r);
      },
      () => {},
      caso === 'expirar' ? 15 : 1000,
    );
    const tarefa = p.perguntar('claude', pergunta, controle.signal);
    await esperar(() => p.pendentes.size === 1);
    if (caso === 'cancelar') p.cancelar([...p.pendentes.keys()][0]);
    if (caso === 'parar') controle.abort();
    assert.equal(((await tarefa) as any).situacao, caso === 'expirar' ? 'expirada' : 'cancelada');
    assert.equal(registros.at(-1)?.situacao, caso === 'expirar' ? 'expirada' : 'cancelada');
  });
test('MCP perguntar_usuario aguarda resposta, gera fase e historico no chat sem cartao de aprovacao', async () => {
  const tmp = await temporario();
  try {
    const db = await banco(tmp.pasta),
      sala = new Sala('s', null, 'Sala', db);
    sala.registrar(fake());
    await sala.iniciar();
    const eventos: DoHost[] = [];
    sala.observar((e) => eventos.push(e));
    const executor = new ExecutorFerramentas(sala, [], async () => {});
    let terminou = false;
    const tarefa = executor
      .executar('claude', 'perguntar_usuario', pergunta, new AbortController().signal)
      .then((r) => {
        terminou = true;
        return r;
      });
    await esperar(() => sala.perguntas.pendentes.size === 1);
    await pausa();
    assert.equal(terminou, false);
    assert.equal(sala.agentes[0].fase?.tipo, 'aguardando_resposta');
    assert(!eventos.some((e) => e.tipo === 'aprovacao'));
    sala.perguntas.responder([...sala.perguntas.pendentes.keys()][0], resposta);
    await tarefa;
    await sala.esperar();
    assert(sala.mensagens.some((m) => m.texto.includes('Qual formato?')));
    assert(sala.mensagens.some((m) => m.texto.includes('Qual formato?: Texto')));
    const registro = (await db.listar<RegistroPergunta>('perguntas', sala.chat.id))[0];
    assert.equal(registro.situacao, 'respondida');
    assert.deepEqual(registro.respostas, resposta);
    await sala.excluirChat(sala.chat.id);
    assert.equal((await db.listar('perguntas')).length, 0);
  } finally {
    await tmp.limpar();
  }
});
test('pergunta mascara segredos antes de eventos e recusa segredo na resposta', async () => {
  const segredo = 'SEGREDO_SINTETICO_V030_78901234567890';
  protegerSegredo(segredo);
  const eventos: DoHost[] = [];
  const p = new Perguntas(
    (e) => eventos.push(e),
    async () => {},
    () => {},
  );
  const tarefa = p.perguntar(
    'claude',
    { ...pergunta, titulo: segredo },
    new AbortController().signal,
  );
  await esperar(() => p.pendentes.size === 1);
  const id = [...p.pendentes.keys()][0];
  assert(!JSON.stringify(eventos).includes(segredo));
  assert.throws(() => p.responder(id, [{ id: 'formato', opcoes: [], texto: segredo }]));
  p.cancelar(id);
  await tarefa;
});

test('encerramento do agente cancela suas perguntas e aguarda a persistencia sem afetar outro agente', async () => {
  const registros: RegistroPergunta[] = [];
  const perguntas = new Perguntas(
    () => {},
    async (p) => {
      await pausa();
      registros.push(p);
    },
    () => {},
  );
  const claude = perguntas.perguntar('claude', pergunta, new AbortController().signal);
  const codex = perguntas.perguntar('codex', pergunta, new AbortController().signal);
  await esperar(() => perguntas.pendentes.size === 2);
  await perguntas.cancelarAgente('claude');
  assert.equal(((await claude) as any).situacao, 'cancelada');
  assert.equal(registros.filter((p) => p.agente === 'claude').at(-1)?.situacao, 'cancelada');
  assert.equal(perguntas.pendentes.size, 1);
  perguntas.cancelarTodas();
  await perguntas.esperar();
  assert.equal(((await codex) as any).situacao, 'cancelada');
  assert.equal(registros.filter((p) => p.agente === 'codex').at(-1)?.situacao, 'cancelada');
});
test('configuracao global migra a mais recente e preserva assistente concluido e conversa', async () => {
  const tmp = await temporario();
  try {
    const storage = await banco(tmp.pasta);
    await storage.finalizar();
    const SQL = await initSqlJs();
    const db = new SQL.Database(await readFile(storage.arquivo));
    db.run('DELETE FROM migrations WHERE versao=3; DELETE FROM globais');
    for (const [id, quando, nick, primeiraExecucao] of [
      ['a', '2026-01-01', 'Antigo', false],
      ['b', '2026-02-01', 'Recente', true],
    ] as const)
      db.run('INSERT INTO salas VALUES (?,?,?,?)', [
        id,
        id,
        quando,
        JSON.stringify({
          configuracao: { ...new Sala('x', null, 'x', storage).config, nick },
          primeiraExecucao,
        }),
      ]);
    for (const [sala, quando, papel] of [
      ['a', '2026-01-01', 'Anterior'],
      ['b', '2026-02-01', 'Atual'],
    ] as const)
      db.run('INSERT INTO provedores VALUES (?,?,?,?)', [
        'claude',
        sala,
        quando,
        JSON.stringify({ ...fake().agente, papel }),
      ]);
    await writeFile(storage.arquivo, db.export());
    db.close();
    await storage.iniciar();
    const global = await storage.obter<ConfigGlobal>('globais', '', 'configuracao');
    assert.equal(global?.configuracao?.nick, 'Recente');
    assert.equal(global?.primeiraExecucao, false);
    assert.equal(global?.agentes.claude.papel, 'Atual');
    await storage.iniciar();
    assert.equal((await storage.listar('globais')).length, 1);
  } finally {
    await tmp.limpar();
  }
});
test('duas janelas propagam configuracao e agentes globais; patches concorrentes nao perdem campos', async () => {
  const tmp = await temporario();
  try {
    const a = new Sala('a', 'projetoA', 'A', await banco(tmp.pasta));
    a.registrar(fake());
    await a.iniciar();
    const b = new Sala('b', 'projetoB', 'B', await banco(tmp.pasta));
    b.registrar(fake());
    await b.iniciar();
    await a.configurar({ nick: 'Usuario', nivel: 'parcial', timeoutMinutos: 25 });
    await a.atualizarAgente('claude', { modo: 'leitura', papel: 'Revisor', habilitado: false });
    await a.concluirAssistente();
    await b.sincronizarGlobal();
    assert.equal(b.config.nivel, 'parcial');
    assert.equal(b.config.nick, 'Usuario');
    assert.equal(b.agentes[0].modo, 'leitura');
    assert.equal(b.agentes[0].habilitado, false);
    assert.equal(b.primeiraExecucao, false);
    await Promise.all([
      a.storage.atualizarGlobal({ configuracao: { timeoutMinutos: 30 } }),
      b.storage.atualizarGlobal({ configuracao: { passagensAutomaticas: 9 } }),
    ]);
    await a.sincronizarGlobal();
    assert.equal(a.config.timeoutMinutos, 30);
    assert.equal(a.config.passagensAutomaticas, 9);
    await a.storage.atualizarGlobal({ voz: padraoVoz() });
    await Promise.all([
      a.storage.atualizarGlobal({ voz: { idioma: 'es' } }),
      b.storage.atualizarGlobal({ voz: { leitura: { variacao: 0.8 } } }),
    ]);
    const global = await a.storage.obter<ConfigGlobal>('globais', '', 'configuracao');
    assert.equal(global?.voz?.idioma, 'es');
    assert.equal(global?.voz?.leitura.variacao, 0.8);
    assert.equal(global?.voz?.modelo, 'small');
    const c = new Sala('avulsa', null, 'Sem pasta', await banco(tmp.pasta));
    c.registrar(fake());
    await c.iniciar();
    assert.equal(c.primeiraExecucao, false);
    assert.equal(c.config.nick, 'Usuario');
    assert.equal(c.agentes[0].papel, 'Revisor');
  } finally {
    await tmp.limpar();
  }
});
test('fases dos tres CLIs incluem ferramentas, pensamento e resposta sem URL sensivel', () => {
  const fases: { tipo: string; detalhe?: string }[] = [];
  const ev: EventosProvedor = {
    fase: (tipo, detalhe) => fases.push({ tipo, detalhe }),
    sessao: () => {},
    fala: () => {},
    parcial: () => {},
    acao: () => {},
    erro: () => {},
  };
  lerEvento(
    'claude',
    {
      type: 'assistant',
      message: {
        content: [
          { type: 'thinking' },
          { type: 'tool_use', name: 'Read', input: { file_path: 'src/app.ts' } },
        ],
      },
    },
    ev,
  );
  lerEvento(
    'codex',
    {
      type: 'item.started',
      item: { type: 'web_search', query: 'https://example.test/pagina?token=privado' },
    },
    ev,
  );
  lerEvento(
    'codex',
    { type: 'item.started', item: { type: 'file_change', changes: [{ path: 'app.ts' }] } },
    ev,
  );
  lerEvento(
    'gemini',
    { type: 'tool_use', tool_name: 'run_shell_command', parameters: { command: 'echo teste' } },
    ev,
  );
  lerEvento('gemini', { type: 'message', role: 'assistant', content: 'Pronto.' }, ev);
  assert(fases.some((f) => f.tipo === 'pensando'));
  assert(fases.some((f) => f.tipo === 'lendo' && f.detalhe === 'src/app.ts'));
  assert(fases.some((f) => f.tipo === 'pesquisando_web'));
  assert(fases.some((f) => f.tipo === 'escrevendo'));
  assert(fases.some((f) => f.tipo === 'executando'));
  assert(fases.some((f) => f.tipo === 'respondendo'));
  assert(!JSON.stringify(fases).includes('privado'));
});
for (const final of ['concluido', 'erro', 'interrompido'] as const)
  test(`sala emite fase final ${final} com duracao`, async () => {
    const tmp = await temporario();
    try {
      const sala = new Sala('s', null, 'Sala', await banco(tmp.pasta));
      sala.registrar(
        fake(async (_p, e, s) => {
          e.fase?.('lendo', 'arquivo');
          if (final === 'erro') throw new Error('Falha sintetica');
          if (final === 'interrompido') {
            await new Promise<void>((r) => s.addEventListener('abort', () => r(), { once: true }));
            return;
          }
          e.fala('Pronto.');
        }),
      );
      await sala.iniciar();
      sala.enviar('@claude faca', []);
      if (final === 'interrompido') {
        await esperar(() => sala.agentes[0].fase?.tipo === 'lendo');
        sala.parar();
      }
      await sala.esperar();
      assert.equal(sala.agentes[0].fase?.tipo, final);
      assert.equal(typeof sala.agentes[0].fase?.duracaoMs, 'number');
      assert(Number.isFinite(Date.parse(sala.agentes[0].fase!.desde)));
    } finally {
      await tmp.limpar();
    }
  });
test('leitura automatica seleciona somente anuncio e resumo; omite codigo/tabelas e limita dois paragrafos', () => {
  const t = new TurnosVoz();
  const m = (id: string, texto: string): Mensagem => ({
    id,
    texto,
    sala: 's',
    quando: 'agora',
    autor: 'Claude',
    tipo: 'fala',
  });
  assert.equal(t.mensagem('claude', { ...m('p', 'parcial'), parcial: true }), undefined);
  assert.equal(
    t.mensagem('claude', m('a', 'Vou conferir o arquivo.'))?.texto,
    'Vou conferir o arquivo.',
  );
  assert.equal(t.mensagem('claude', m('b', 'Resultado intermediario.')), undefined);
  t.mensagem(
    'claude',
    m(
      'c',
      'Conferi tudo.\n\nOs testes passaram.\n\nNao ler este terceiro paragrafo.\n```js\nsegredo()\n```\n| campo | valor |',
    ),
  );
  assert.equal(t.concluir('claude')?.texto, 'Conferi tudo. Os testes passaram.');
  assert.equal(t.concluir('claude'), undefined);
  assert.equal(trechoAutomatico('x'.repeat(1000)).length, 600);
  assert.equal(trechoAutomatico('x'.repeat(301), true), '');
  assert(!trechoAutomatico('```js\nx()\n```').includes('x()'));
});
test('Piper usa stdin, varia ritmo/entonacao e remove WAV em sucesso, erro e cancelamento', async () => {
  const tmp = await temporario();
  try {
    for (const caso of ['sucesso', 'erro', 'cancelar']) {
      const chamadas: { cmd: string; args: string[]; entrada: string }[] = [];
      let avisar!: () => void;
      const iniciou = new Promise<void>((r) => (avisar = r));
      const fabrica = (cmd: string, args: string[]) => {
        const linha = { cmd, args, entrada: '' };
        chamadas.push(linha);
        let resolver!: (r: any) => void;
        const resultado = new Promise<any>((r) => (resolver = r));
        return {
          resultado,
          escrever: (texto: string) => {
            linha.entrada += texto;
          },
          fecharEntrada: () => {
            if (cmd === 'piper') {
              void writeFile(
                args[args.indexOf('--output_file') + 1],
                wavPcm(Buffer.alloc(20), 24000),
              ).then(() => {
                avisar();
                if (caso !== 'cancelar')
                  resolver({ codigo: caso === 'erro' ? 1 : 0, saida: '', erro: '' });
              });
            } else queueMicrotask(() => resolver({ codigo: 0, saida: '', erro: '' }));
          },
          cancelar: () => resolver({ codigo: null, saida: '', erro: '' }),
        };
      };
      const leitor = new Leitor(tmp.pasta, fabrica, 'win32', {
        modelo: () => 'modelo-licenciado-fixture.onnx',
      });
      const leitura = {
        ...estadoInicialVoz().leitura,
        motor: 'piper' as const,
        variacao: 0.8,
        velocidade: 1.5,
      };
      const tarefa = leitor.ler('piper', 'Texto privado da fala.', leitura);
      const settled = tarefa.catch((e) => e);
      await iniciou;
      if (caso === 'cancelar') await leitor.parar();
      const resultado = await settled;
      if (caso === 'erro') assert(resultado instanceof Error);
      assert(chamadas[0].entrada.includes('Texto privado'));
      assert(!JSON.stringify(chamadas.map((c) => c.args)).includes('Texto privado'));
      assert((await readdir(tmp.pasta)).length === 0);
      assert(argumentosPiper('m', 'a', 1.5, 0.8).includes(String(1 / 1.5)));
    }
  } finally {
    await tmp.limpar();
  }
});
test('Piper extrai DLLs/dados preservando pastas; voz com licenca nao verificada nao instala', async () => {
  const tmp = await temporario();
  try {
    const zip = new JSZip();
    for (const p of [
      'piper/piper.exe',
      'piper/onnxruntime.dll',
      'piper/espeak-ng-data/pt_dict',
      'piper/espeak-ng-data/lang/roa/pt',
      'piper/README-proibido.exe',
    ])
      zip.file(p, 'fixture');
    const arquivo = join(tmp.pasta, 'p.zip');
    await writeFile(arquivo, await zip.generateAsync({ type: 'nodebuffer' }));
    await extrairBinarios(arquivo, join(tmp.pasta, 'runtime'), 'piper');
    assert.equal(
      await readFile(join(tmp.pasta, 'runtime/espeak-ng-data/lang/roa/pt'), 'utf8'),
      'fixture',
    );
    assert(!(await readdir(join(tmp.pasta, 'runtime'))).includes('README-proibido.exe'));
    assert.equal(VOZES_COMERCIAIS.length, 0);
    assert.throws(() => artefato('voz_neural', 'small'), /licenca comercial/);
  } finally {
    await tmp.limpar();
  }
});
for (const provedor of ['openai', 'elevenlabs'] as const)
  for (const status of [200, 401, 'timeout'] as const)
    test(`chave TTS ${provedor} ${status}: valida antes de salvar, sem emitir segredo`, async () => {
      const segredos = new Map<string, string>();
      let pedidos = 0;
      const chave = provedor === 'openai' ? 'sk-' + 'SINTETICO'.repeat(6) : 'SINTETICO'.repeat(6);
      const servidor = createServer((req, res) => {
        pedidos++;
        assert.equal(req.method, 'GET');
        assert.equal(
          req.headers[provedor === 'openai' ? 'authorization' : 'xi-api-key'],
          provedor === 'openai' ? `Bearer ${chave}` : chave,
        );
        if (status === 'timeout') return;
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ voices: [{ voice_id: 'voz_fixture', name: 'Voz sintetica' }] }));
      });
      await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
      const porta = (servidor.address() as any).port;
      const nuvem = new VozNuvem(
        {
          get: async (id) => segredos.get(id),
          store: async (id, valor) => {
            segredos.set(id, valor);
          },
          delete: async (id) => {
            segredos.delete(id);
          },
        },
        `http://127.0.0.1:${porta}`,
        50,
      );
      try {
        if (status === 200) {
          assert((await nuvem.salvar(provedor, chave)).length > 0);
          assert.equal(segredos.get(segredoTts(provedor)), chave);
          await nuvem.remover();
          assert.equal(segredos.size, 0);
        } else
          await assert.rejects(nuvem.salvar(provedor, chave), (e) => {
            assert(!(e as Error).message.includes(chave));
            return true;
          });
        assert.equal(pedidos, 1);
        if (status !== 200) assert.equal(segredos.size, 0);
        await assert.rejects(nuvem.salvar(provedor, 'curta'));
        assert.equal(pedidos, 1);
      } finally {
        servidor.closeAllConnections();
        await new Promise<void>((r) => servidor.close(() => r()));
      }
    });
test('protocolo v5 aceita respostas, cancelamento e voz natural; recusa excesso e campos extras', () => {
  for (const m of [
    { tipo: 'responderPergunta', id: 'q', respostas: resposta },
    { tipo: 'cancelarPergunta', id: 'q' },
    { tipo: 'leituraConfigurar', motor: 'piper', variacao: 0.7 },
    { tipo: 'leituraNuvemRemover' },
    { tipo: 'vozInstalar', componentes: ['piper', 'voz_neural'] },
  ])
    assert.deepEqual(validarMensagem(m), m);
  for (const m of [
    { tipo: 'responderPergunta', id: 'q', respostas: [] },
    { tipo: 'leituraConfigurar', variacao: 1.1 },
    { tipo: 'leituraNuvemChave', provedor: 'desconhecido', chave: 'x' },
  ])
    assert.throws(() => validarMensagem(m));
});

for (const provedor of ['openai', 'elevenlabs'] as const)
  test(`TTS ${provedor} sintetiza apenas no servidor simulado, sem chaves em corpo/eventos e limpa audio`, async () => {
    const tmp = await temporario();
    const chave = provedor === 'openai' ? 'sk-' + 'FIXTURE'.repeat(8) : 'FIXTURE'.repeat(8);
    let pedidos = 0;
    let textoRecebido = '';
    let corpoRecebido = '';
    const server = createServer(async (req, res) => {
      assert.equal(req.method, 'POST');
      pedidos++;
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c);
      corpoRecebido = Buffer.concat(chunks).toString();
      const j = JSON.parse(corpoRecebido);
      textoRecebido = j.input ?? j.text;
      if (provedor === 'openai') res.end(wavPcm(Buffer.alloc(32), 24000));
      else res.end(Buffer.alloc(32));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const nuvem = new VozNuvem(
      { get: async () => chave, store: async () => {} },
      `http://127.0.0.1:${(server.address() as any).port}`,
    );
    let arquivoLido = '';
    const leitor = new Leitor(
      tmp.pasta,
      (_cmd, args) => {
        let entrada = '';
        return {
          resultado: new Promise<any>((resolve) =>
            queueMicrotask(() => resolve({ codigo: 0, saida: '', erro: '' })),
          ),
          escrever: (txt) => {
            entrada += txt;
            arquivoLido = JSON.parse(entrada).arquivo;
          },
          fecharEntrada: () => {},
          cancelar: () => {},
        };
      },
      'win32',
      { nuvem },
    );
    try {
      await leitor.ler('nuvem', 'Resumo **natural**.\n```js\nnao_enviar()\n```', {
        ...estadoInicialVoz().leitura,
        motor: 'nuvem',
        voz: provedor === 'openai' ? 'coral' : 'voz_fixture',
        nuvem: { provedor, chaveConfigurada: true },
      });
      assert.equal(pedidos, 1);
      assert(textoRecebido.includes('Resumo natural'));
      assert(!textoRecebido.includes('nao_enviar'));
      assert(!corpoRecebido.includes(chave));
      assert(arquivoLido.endsWith('voz.wav'));
      assert.deepEqual(await readdir(tmp.pasta), []);
    } finally {
      await leitor.parar();
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      await tmp.limpar();
    }
  });

test('controle de voz global valida chave, mantem nuvem desligada, emite aviso ao ativar e sincroniza outra janela', async () => {
  const tmp = await temporario();
  const segredos = new Map<string, string>();
  const eventos: DoHost[] = [];
  let global = padraoVoz();
  let pedidos = 0;
  const server = createServer((_req, res) => {
    pedidos++;
    res.end('{}');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const nuvem = new VozNuvem(
    {
      get: async (id) => segredos.get(id),
      store: async (id, c) => {
        segredos.set(id, c);
      },
      delete: async (id) => {
        segredos.delete(id);
      },
    },
    `http://127.0.0.1:${(server.address() as any).port}`,
  );
  const voz = new VozLocal({
    pasta: tmp.pasta,
    nuvem,
    carregar: async () => structuredClone(global),
    salvar: async (p) => {
      global = { ...global, ...p, leitura: { ...global.leitura, ...p.leitura } };
      return structuredClone(global);
    },
    emitir: (e) => eventos.push(e),
    agentes: () => [fake().agente],
    enviar: () => {},
    auditar: async () => {},
    detectar: async (_p, c) => ({
      modelo: 'fixture',
      tts: 'fixture',
      estado: {
        ...estadoInicialVoz(),
        ...c,
        leitura: {
          ...estadoInicialVoz().leitura,
          ...c.leitura,
          motor: c.leitura.motor ?? 'sistema',
          disponivel: true,
          motores: [
            { id: 'sistema', disponivel: true },
            { id: 'nuvem', disponivel: false },
          ],
          vozes: [],
        },
      },
    }),
  });
  const chave = 'sk-' + 'FIXTURE'.repeat(8);
  try {
    await voz.inicializar();
    await voz.chaveNuvem('openai', chave);
    assert.equal(pedidos, 1);
    assert.equal(voz.estado.leitura.motor, 'sistema');
    assert.equal(voz.estado.leitura.ativa, false);
    assert(voz.estado.leitura.nuvem.chaveConfigurada);
    assert(!JSON.stringify(eventos).includes(chave));
    await voz.configurarLeitura({ motor: 'nuvem' });
    assert.equal(voz.estado.leitura.voz, 'coral');
    assert(eventos.some((e) => e.tipo === 'aviso' && e.texto.includes('texto lido sera enviado')));
    global.leitura.velocidade = 1.6;
    await voz.sincronizar();
    assert.equal(voz.estado.leitura.velocidade, 1.6);
    await voz.removerChaveNuvem();
    assert.equal(segredos.size, 0);
    assert.equal(voz.estado.leitura.motor, 'sistema');
  } finally {
    await voz.finalizar();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await tmp.limpar();
  }
});

test('ouvir mensagem inteira divide fala longa sem codigo, texto fora dos argumentos e sem temporarios', async () => {
  const tmp = await temporario();
  const lidos: string[] = [];
  const leitor = new Leitor(
    tmp.pasta,
    (_cmd, args) => {
      let txt = '';
      return {
        resultado: new Promise<any>((r) =>
          queueMicrotask(() => r({ codigo: 0, saida: '', erro: '' })),
        ),
        escrever: (s) => {
          txt += s;
          lidos.push(JSON.parse(txt).texto);
          assert(!args.join(' ').includes('palavra'));
        },
        fecharEntrada: () => {},
        cancelar: () => {},
      };
    },
    'win32',
  );
  try {
    await leitor.ler(
      'fixture',
      'palavra '.repeat(500) + 'FIMDAFALA\n```js\nnao_ler()\n```',
      estadoInicialVoz().leitura,
    );
    assert(lidos.length >= 3);
    assert(lidos.join(' ').includes('FIMDAFALA'));
    assert(!lidos.join(' ').includes('nao_ler'));
    assert(lidos.every((s) => s.length <= 1500));
    assert.deepEqual(await readdir(tmp.pasta), []);
  } finally {
    await leitor.parar();
    await tmp.limpar();
  }
});

for (const id of [
  'ollama',
  'openai-compativel',
  'openai-api',
  'anthropic',
  'gemini-api',
] as ApiId[])
  test(`API ${id} deriva fases de ferramenta e resposta com HTTP ficticio`, async () => {
    let rodada = 0;
    const server = createServer(async (req, res) => {
      for await (const _c of req) {
      }
      rodada++;
      res.setHeader('content-type', 'application/json');
      if (id === 'anthropic')
        res.end(
          JSON.stringify({
            content:
              rodada === 1
                ? [{ type: 'tool_use', id: 't', name: 'arquivo_ler', input: { caminho: 'app.ts' } }]
                : [{ type: 'text', text: 'Pronto.' }],
          }),
        );
      else if (id === 'gemini-api')
        res.end(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts:
                    rodada === 1
                      ? [{ functionCall: { name: 'arquivo_ler', args: { caminho: 'app.ts' } } }]
                      : [{ text: 'Pronto.' }],
                },
              },
            ],
          }),
        );
      else {
        const message =
          rodada === 1
            ? {
                content: '',
                tool_calls: [
                  {
                    id: 't',
                    function: {
                      name: 'arquivo_ler',
                      arguments: JSON.stringify({ caminho: 'app.ts' }),
                    },
                  },
                ],
              }
            : { content: 'Pronto.' };
        res.end(JSON.stringify(id === 'ollama' ? { message } : { choices: [{ message }] }));
      }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const fases: string[] = [];
    const p = new ProvedorApi(
      id,
      { get: async () => 'CHAVE_FIXTURE_API', store: async () => {} },
      () => ({ baseUrl: `http://127.0.0.1:${(server.address() as any).port}`, modelo: 'fixture' }),
    );
    try {
      await p.executar(
        {
          prompt: 'fixture',
          projeto: '.',
          nivel: 'manual',
          modo: 'leitura',
          ponte: { url: '', token: '', servidor: '', diretorio: '' },
          ferramenta: async () => 'conteudo',
        },
        {
          sessao: () => {},
          fala: () => {},
          parcial: () => {},
          acao: () => {},
          erro: () => {},
          fase: (t) => fases.push(t),
        },
        new AbortController().signal,
      );
      assert(fases.includes('pensando'));
      assert(fases.includes('lendo'));
      assert(fases.includes('respondendo'));
      assert.equal(rodada, 2);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
