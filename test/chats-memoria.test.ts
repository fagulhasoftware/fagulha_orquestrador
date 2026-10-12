import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFile, readFile, mkdir, access } from 'node:fs/promises';
import initSqlJs from 'sql.js';
import { Sala } from '../src/core/sala';
import { Armazenamento } from '../src/storage/sqlite';
import { tabelasChat } from '../src/storage/migracoes';
import { agentePadrao, type Provedor, type PedidoExecucao } from '../src/providers/tipos';
import { contextoMemorias } from '../src/core/memoria';
import { ExecutorFerramentas } from '../src/mcp/executor';
import { decidir } from '../src/permissions/matriz';
import { validarMensagem } from '../src/core/protocolo';
import { Anexador } from '../src/attachments/pipeline';
import type {
  DoHost,
  Memoria,
  Mensagem,
  ModoAgente,
  NivelPermissao,
} from '../src/shared/protocolo';
import { banco, temporario } from './apoio';

function provedor(pedidos: PedidoExecucao[] = []): Provedor {
  const agente = agentePadrao('codex', 'Codex', 'cli', 'verde');
  agente.instalado = agente.habilitado = true;
  return {
    agente,
    detectar: async () => ({ instalado: true }),
    estadoLogin: async () => 'conectado',
    login: async () => {},
    executar: async (p, e) => {
      pedidos.push(p);
      e.sessao(p.sessao ?? 'thread-' + pedidos.length);
      e.fala('Resposta final');
    },
  };
}
async function sala(
  db: Armazenamento,
  id = 's',
  projeto: string | null = 'projeto',
  pedidos?: PedidoExecucao[],
): Promise<Sala> {
  const s = new Sala(id, projeto, 'Projeto', db);
  s.registrar(provedor(pedidos));
  await s.iniciar();
  return s;
}

test('migracao v1 preserva todas as entidades, titulo, pendentes e sessoes; e idempotente', async () => {
  const tmp = await temporario();
  try {
    const sql = await initSqlJs();
    const legado = new sql.Database();
    legado.run(
      'CREATE TABLE migrations (versao INTEGER PRIMARY KEY); INSERT INTO migrations VALUES (1)',
    );
    for (const t of ['salas', 'provedores', ...tabelasChat])
      legado.run(
        `CREATE TABLE ${t} (id TEXT NOT NULL,sala TEXT NOT NULL,quando TEXT NOT NULL,dados TEXT NOT NULL,PRIMARY KEY(sala,id))`,
      );
    const gravar = (t: string, id: string, d: unknown) =>
      legado.run(`INSERT INTO ${t} VALUES (?,?,?,?)`, [
        id,
        'legado',
        '2026-01-01T00:00:00.000Z',
        JSON.stringify(d),
      ]);
    gravar('salas', 'legado', {
      configuracao: { nick: 'Pessoa', limites: {} },
      primeiraExecucao: false,
      anexosPendentes: ['anexo'],
    });
    gravar('provedores', 'codex', provedor().agente);
    gravar('mensagens', 'm1', {
      id: 'm1',
      sala: 'legado',
      quando: '2026-01-01',
      autor: 'Pessoa',
      tipo: 'fala',
      texto: '@codex Planejar a publicacao',
    });
    gravar('mensagens', 'm2', {
      id: 'm2',
      sala: 'legado',
      quando: '2026-01-02',
      autor: 'Codex',
      tipo: 'fala',
      texto: 'Vamos planejar',
    });
    gravar('acoes', 'a1', { id: 'a1', texto: 'Ler' });
    gravar('aprovacoes', 'p1', { id: 'p1', decisao: 'aprovar' });
    gravar('anexos', 'anexo', {
      meta: { id: 'anexo', nome: 'a.txt', tipo: 'texto', bytes: 2, tratamento: 'integral' },
      texto: 'oi',
    });
    gravar('contextos', 'c1', {
      meta: { id: 'c1', titulo: 'Referencia', origem: 'arquivo', caracteres: 2 },
      texto: 'oi',
    });
    gravar('sessoes_provedor', 'codex', {
      id: 'thread-antigo',
      modo: 'leitura_escrita',
      nivel: 'manual',
      visto: 1,
    });
    const arquivo = join(tmp.pasta, 'legado.sqlite');
    await writeFile(arquivo, legado.export());
    legado.close();
    const db = new Armazenamento(arquivo);
    await db.iniciar({ sala: 'legado', projeto: tmp.pasta, titulo: 'Legado' });
    const restaurada = await sala(db, 'legado', tmp.pasta);
    assert.equal(restaurada.chat.titulo, 'Planejar a publicacao');
    assert.equal(restaurada.chat.projeto, tmp.pasta);
    assert.equal(restaurada.mensagens.length, 2);
    assert.deepEqual(restaurada.chat.agentes, ['Codex']);
    assert.equal(restaurada.estado().anexosPendentes.length, 1);
    assert.equal(restaurada.estado().contextos.length, 1);
    assert.equal(restaurada.agentes[0].temSessao, true);
    for (const t of tabelasChat.filter((t) => t !== 'perguntas'))
      assert((await db.listar(t, restaurada.chat.id)).length > 0, t);
    const verificador = new sql.Database(await readFile(arquivo));
    assert.equal(verificador.exec('PRAGMA foreign_key_check').length, 0);
    verificador.close();
    await db.iniciar();
    assert.equal((await db.listar('chats')).length, 1);
    const outra = await sala(db, 'outra-pasta', join(tmp.pasta, 'outra'));
    await outra.abrirChat(restaurada.chat.id);
    assert.equal(outra.agentes[0].temSessao, false, 'sessao legada de outra pasta nao e retomada');
    await restaurada.esperar();
  } finally {
    await tmp.limpar();
  }
});

test('reabertura restaura ultimo chat e thread; Novo chat isola; outra pasta executa na pasta da janela', async () => {
  const tmp = await temporario();
  try {
    const db = await banco(tmp.pasta),
      pedidos: PedidoExecucao[] = [];
    const s = await sala(db, 's', 'projeto-A', pedidos);
    const primeiro = s.chat.id;
    s.enviar('@codex Organizar informações', []);
    await s.esperar();
    assert.equal(s.chat.titulo, 'Organizar informações');
    await s.novoChat();
    const segundo = s.chat.id;
    assert.notEqual(segundo, primeiro);
    assert.equal(s.mensagens.length, 0);
    assert.equal(s.agentes[0].temSessao, false);
    s.enviar('@codex Nova conversa', []);
    await s.esperar();
    assert.equal(pedidos[1].sessao, undefined);
    const novaStorage = new Armazenamento(db.arquivo);
    await novaStorage.iniciar();
    const reaberta = await sala(novaStorage, 's', 'projeto-A', pedidos);
    assert.equal(reaberta.chat.id, segundo);
    assert(reaberta.agentes[0].temSessao);
    reaberta.enviar('@codex continue', []);
    await reaberta.esperar();
    assert.equal(pedidos[2].sessao, 'thread-2');
    await reaberta.abrirChat(primeiro);
    assert(reaberta.agentes[0].temSessao);
    const outra = await sala(novaStorage, 'outra', 'projeto-B', pedidos);
    await outra.abrirChat(primeiro);
    assert.equal(outra.estado().chat.desteProjeto, false);
    assert.equal(outra.agentes[0].temSessao, false);
    outra.enviar('@codex use esta pasta', []);
    await outra.esperar();
    assert.equal(pedidos.at(-1)?.projeto, 'projeto-B');
    assert.equal(pedidos.at(-1)?.sessao, undefined);
    assert(
      (await outra.listarChats()).some(
        (c) => c.id === segundo && c.mensagens >= 2 && c.agentes.includes('Codex'),
      ),
    );
    const mesmoProjeto = await sala(novaStorage, 'outra-janela', 'projeto-A');
    assert.equal(mesmoProjeto.chat.projeto, 'projeto-A');
  } finally {
    await tmp.limpar();
  }
});

test('janela sem pasta restaura so chats sem projeto; busca ignora caixa e acentos com trecho simples', async () => {
  const tmp = await temporario();
  try {
    const db = await banco(tmp.pasta);
    const projeto = await sala(db);
    projeto.enviar('Chat do projeto', []);
    await projeto.esperar();
    const avulsa = await sala(db, 'avulsa', null);
    avulsa.enviar('Planejar a apresentação', []);
    await avulsa.esperar();
    avulsa.mensagem('Codex', '**Decisão**: publicar na próxima reunião.');
    await avulsa.esperar();
    const nova = await sala(db, 'janela-sem-pasta', null);
    assert.equal(nova.chat.id, avulsa.chat.id);
    const lista = await nova.listarChats('DECISAO');
    assert.equal(lista.length, 1);
    assert.equal(lista[0].id, avulsa.chat.id);
    assert(lista[0].trecho?.includes('Decisão'));
    assert(!lista[0].trecho?.includes('**'));
    assert.equal((await nova.listarChats('apresentacao'))[0].id, avulsa.chat.id);
    await nova.renomearChat(nova.chat.id, 'Titulo manual');
    nova.enviar('nao sobrescrever titulo', []);
    await nova.esperar();
    assert.equal(nova.chat.titulo, 'Titulo manual');
    await nova.fixarChat(nova.chat.id, true);
    assert.equal((await nova.listarChats())[0].fixado, true);
    await nova.renomearChat(nova.chat.id, 'Titulo editavel '.repeat(7).trim());
    assert(nova.chat.titulo.length > 60 && nova.chat.titulo.length <= 120);
    assert.equal((await nova.mensagensChat(projeto.chat.id))[0].texto, 'Chat do projeto');
  } finally {
    await tmp.limpar();
  }
});

test('duas instancias mesclam mensagens e preservam renomeacao e anexos pendentes', async () => {
  const tmp = await temporario();
  try {
    const db = await banco(tmp.pasta),
      db2 = new Armazenamento(db.arquivo);
    await db2.iniciar();
    const a = await sala(db),
      b = await sala(db2);
    assert.equal(a.chat.id, b.chat.id);
    a.enviar('primeira', []);
    b.enviar('segunda', []);
    await Promise.all([a.esperar(), b.esperar()]);
    await a.renomearChat(a.chat.id, 'Compartilhado');
    b.enviar('terceira', []);
    await b.esperar();
    await a.adicionarAnexo({
      meta: { id: 'pendente', nome: 'p.txt', tipo: 'texto', tratamento: 'integral', bytes: 1 },
      texto: 'p',
    });
    await b.sincronizar();
    assert.equal(b.chat.titulo, 'Compartilhado');
    assert.equal(b.mensagens.length, 3);
    assert.equal(b.estado().anexosPendentes.length, 1);
    assert.equal(b.chat.mensagens, 3);
  } finally {
    await tmp.limpar();
  }
});

test('exclusao em cascata remove dados e somente arquivos sem outra referencia; substitui chat ativo', async () => {
  const tmp = await temporario();
  try {
    const db = await banco(tmp.pasta),
      s = await sala(db);
    const primeiro = s.chat.id;
    const pasta = join(tmp.pasta, 'anexos');
    await mkdir(pasta);
    const compartilhado = join(pasta, 'a'.repeat(64)),
      unico = join(pasta, 'b'.repeat(64));
    await writeFile(compartilhado, 'compartilhado');
    await writeFile(unico, 'unico');
    for (const [id, arquivo] of [
      ['a', compartilhado],
      ['b', unico],
    ])
      await s.adicionarAnexo({
        meta: { id, nome: 'p.txt', tipo: 'texto', tratamento: 'integral', bytes: 1 },
        texto: 'p',
        arquivo,
      });
    await s.adicionarContexto({
      meta: { id: 'c', origem: 'sala-orquestra', titulo: 'c', caracteres: 1 },
      texto: 'c',
    });
    s.enviar('@codex oi', []);
    await s.esperar();
    await db.gravarDoChat('aprovacoes', primeiro, 'p', { id: 'p', decisao: 'aprovar' });
    s.mensagem('Codex', 'acao', 'acao');
    await s.esperar();
    await s.novoChat();
    await s.adicionarAnexo({
      meta: { id: 'ref', nome: 'p.txt', tipo: 'texto', tratamento: 'integral', bytes: 1 },
      texto: 'p',
      arquivo: compartilhado,
    });
    const arquivos = await s.excluirChat(primeiro);
    assert.deepEqual(arquivos, [unico]);
    const anexador = new Anexador(pasta, '', () => s.config.limites);
    await anexador.excluirSemReferencia([...arquivos, join(tmp.pasta, 'externo')], async (p) =>
      (await db.listar<{ arquivo?: string }>('anexos')).some((a) => a.arquivo === p),
    );
    await assert.rejects(access(unico));
    await access(compartilhado);
    for (const t of tabelasChat) assert.equal((await db.listar(t, primeiro)).length, 0, t);
    assert.equal(await db.obter('chats', '', primeiro), undefined);
    const ativo = s.chat.id;
    await s.excluirChat(ativo);
    assert.notEqual(s.chat.id, ativo);
    assert.equal(s.mensagens.length, 0);
  } finally {
    await tmp.limpar();
  }
});

test('memoria CRUD, escopos, recusa de segredo sem evento ou persistencia e reabertura', async () => {
  const tmp = await temporario();
  try {
    const db = await banco(tmp.pasta),
      s = await sala(db),
      eventos: DoHost[] = [];
    s.observar((e) => eventos.push(e));
    const global = await s.salvarMemoria({ texto: 'Respostas curtas', escopo: 'global' });
    const local = await s.salvarMemoria({ texto: 'Usar TypeScript', escopo: 'projeto' });
    const outra = await sala(db, 'outra', 'outro');
    await outra.salvarMemoria({ texto: 'Usar Python', escopo: 'projeto' });
    await s.atualizarMemorias();
    assert.equal(s.estado().memoriasAtivas, 2);
    for (const texto of [
      'sk-' + 'X'.repeat(32),
      'password=abc123',
      'senha: abc123',
      'token=abc123',
      'x'.repeat(501),
    ]) {
      const antes = eventos.length;
      await assert.rejects(s.salvarMemoria({ texto, escopo: 'global' }));
      assert.equal(eventos.length, antes);
      assert(!(await readFile(db.arquivo)).includes(Buffer.from(texto)));
    }
    const editada = await s.salvarMemoria({
      id: local.id,
      texto: 'Usar JavaScript',
      escopo: 'projeto',
      ativa: false,
    });
    assert.equal(editada.id, local.id);
    assert.equal(s.estado().memoriasAtivas, 1);
    await s.excluirMemoria(global.id);
    assert.equal(s.estado().memoriasAtivas, 0);
    const reaberta = await sala(db);
    assert.equal((await reaberta.memorias.listar()).length, 2);
    const avulsa = await sala(db, 'avulsa', null);
    await assert.rejects(avulsa.salvarMemoria({ texto: 'local', escopo: 'projeto' }));
  } finally {
    await tmp.limpar();
  }
});

test('contexto de memoria tem teto 4000, recentes primeiro e somente escopos ativos da janela', () => {
  const memorias: Memoria[] = Array.from({ length: 20 }, (_, i) => ({
    id: String(i),
    texto: `Fato ${i}: ` + 'x'.repeat(480),
    escopo: 'global',
    projeto: null,
    projetoNome: null,
    origem: 'usuario',
    ativa: true,
    criadaEm: '2026',
    atualizadaEm: `2026-01-${String(i + 1).padStart(2, '0')}`,
  }));
  memorias.push({
    ...memorias[0],
    id: 'fora',
    texto: 'PROJETO FORA',
    escopo: 'projeto',
    projeto: 'outro',
  });
  memorias.push({ ...memorias[0], id: 'inativa', texto: 'DESATIVADA', ativa: false });
  const contexto = contextoMemorias(memorias, 'atual');
  assert(contexto.length <= 4000);
  assert(contexto.indexOf('Fato 19') < contexto.indexOf('Fato 18'));
  assert(!contexto.includes('PROJETO FORA'));
  assert(!contexto.includes('DESATIVADA'));
  assert(!contexto.includes('Fato 0:'));
});

for (const nivel of ['manual', 'parcial', 'total'] as NivelPermissao[])
  for (const modo of ['leitura', 'escrita', 'leitura_escrita'] as ModoAgente[])
    test(`memoria exige aprovacao: ${nivel} / ${modo}`, () =>
      assert.equal(decidir(nivel, modo, 'memoria'), nivel === 'total' ? 'automatica' : 'aprovar'));

test('MCP memoria_propor so grava aprovada, nao reutiliza aprovar_sessao e nao emite segredos', async () => {
  const tmp = await temporario();
  try {
    const db = await banco(tmp.pasta),
      s = await sala(db);
    s.config.nivel = 'parcial';
    const executor = new ExecutorFerramentas(s, [], async () => {}),
      signal = new AbortController().signal;
    const eventos: DoHost[] = [];
    let aprovacoes = 0;
    s.observar((e) => {
      eventos.push(e);
      if (e.tipo === 'aprovacao') {
        aprovacoes++;
        assert.equal(e.pedido.categoria, 'memoria');
        assert.equal(e.pedido.critica, true);
        queueMicrotask(() =>
          s.portao.responder(e.pedido.id, aprovacoes === 1 ? 'negar' : 'aprovar_sessao'),
        );
      }
    });
    const propor = () =>
      executor.executar(
        'codex',
        'memoria_propor',
        { texto: 'Preferir testes locais', escopo: 'global' },
        signal,
      );
    await assert.rejects(propor());
    assert.equal((await s.memorias.listar()).length, 0);
    await propor();
    await propor();
    assert.equal(aprovacoes, 3);
    const memorias = await s.memorias.listar();
    assert.equal(memorias.length, 2);
    assert.equal(memorias[0].origem, 'agente');
    assert.equal(memorias[0].agente, 'Codex');
    const antes = eventos.length,
      segredo = 'sk-' + 'Z'.repeat(32);
    await assert.rejects(
      executor.executar('codex', 'memoria_propor', { texto: segredo, escopo: 'global' }, signal),
    );
    assert.equal(eventos.length, antes);
    assert(!JSON.stringify(eventos).includes(segredo));
    await s.esperar();
  } finally {
    await tmp.limpar();
  }
});

test('todos os novos comandos v4 sao validados estritamente', () => {
  for (const m of [
    { tipo: 'novoChat' },
    { tipo: 'listarChats', busca: 'ação' },
    { tipo: 'abrirChat', id: 'c' },
    { tipo: 'renomearChat', id: 'c', titulo: 'Titulo' },
    { tipo: 'fixarChat', id: 'c', fixado: true },
    { tipo: 'excluirChat', id: 'c' },
    { tipo: 'exportarChat', id: 'c' },
    { tipo: 'listarMemorias' },
    { tipo: 'salvarMemoria', texto: 'Texto', escopo: 'global' },
    { tipo: 'excluirMemoria', id: 'm' },
  ])
    assert.deepEqual(validarMensagem(m), m);
  assert.throws(() => validarMensagem({ tipo: 'salvarMemoria', texto: 'x', escopo: 'fora' }));
  assert.throws(() => validarMensagem({ tipo: 'novoChat', id: 'injetado' }));
});

test('pedido pendente de outra janela permanece respondível; morto/expirado nao e retomado', async () => {
  const tmp = await temporario();
  try {
    const db = await banco(tmp.pasta),
      a = await sala(db);
    const executor = new ExecutorFerramentas(a, [], async () => {});
    let pronto!: () => void;
    const anunciado = new Promise<void>((r) => {
      pronto = r;
    });
    a.observar((e) => {
      if (e.tipo === 'aprovacao') pronto();
    });
    const proposta = executor.executar(
      'codex',
      'memoria_propor',
      { texto: 'Preferir comentarios curtos', escopo: 'global' },
      new AbortController().signal,
    );
    await anunciado;
    await a.esperar();
    const b = await sala(db);
    assert.equal(b.estado().aprovacoes.length, 1);
    await b.responderAprovacao(b.estado().aprovacoes[0].id, 'aprovar');
    await proposta;
    assert.equal((await b.memorias.listar()).length, 1);
    await a.esperar();
    await db.gravarDoChat('aprovacoes', a.chat.id, 'expirado', {
      id: 'expirado',
      categoria: 'memoria',
      resumo: 'Proposta interrompida',
      detalhe: 'teste',
      agente: 'codex',
      critica: true,
      expiraEm: '2000-01-01',
      donoPid: process.pid,
    });
    await b.sincronizar();
    assert.equal(b.estado().aprovacoes.length, 0);
    assert.equal(
      (await db.obter<{ decisao: string }>('aprovacoes', a.chat.id, 'expirado'))?.decisao,
      'expirada',
    );
  } finally {
    await tmp.limpar();
  }
});

test('trocar de chat cancela proposta sem guardar memoria', async () => {
  const tmp = await temporario();
  try {
    const db = await banco(tmp.pasta),
      s = await sala(db),
      executor = new ExecutorFerramentas(s, [], async () => {});
    let pronto!: () => void;
    const anunciado = new Promise<void>((r) => {
      pronto = r;
    });
    s.observar((e) => {
      if (e.tipo === 'aprovacao') pronto();
    });
    const proposta = executor.executar(
      'codex',
      'memoria_propor',
      { texto: 'Fato duravel', escopo: 'global' },
      new AbortController().signal,
    );
    const negada = assert.rejects(proposta);
    await anunciado;
    await s.novoChat();
    await negada;
    await s.esperar();
    assert.equal((await s.memorias.listar()).length, 0);
    assert.equal(s.estado().aprovacoes.length, 0);
  } finally {
    await tmp.limpar();
  }
});

test('memoria e injetada em provedores CLI e API no projeto da janela, inclusive em chat externo', async () => {
  const tmp = await temporario();
  try {
    const db = await banco(tmp.pasta),
      origem = await sala(db, 'origem', 'pasta-origem');
    await origem.salvarMemoria({ texto: 'FACTO SOMENTE ORIGEM', escopo: 'projeto' });
    const s = new Sala('destino', 'pasta-destino', 'Destino', db);
    const pedidos: PedidoExecucao[] = [];
    for (const tipo of ['cli', 'api'] as const) {
      const p = provedor(pedidos);
      p.agente.id = tipo;
      p.agente.nick = tipo;
      p.agente.tipo = tipo;
      s.registrar(p);
    }
    await s.iniciar();
    await s.salvarMemoria({ texto: 'FACTO GLOBAL', escopo: 'global' });
    await s.salvarMemoria({ texto: 'FACTO DESTINO', escopo: 'projeto' });
    await s.abrirChat(origem.chat.id);
    s.enviar('@todos responder', []);
    await s.esperar();
    assert.equal(pedidos.length, 2);
    for (const p of pedidos) {
      assert(p.prompt.includes('Memoria do usuario (preferencias e decisoes persistentes)'));
      assert(p.prompt.includes('FACTO GLOBAL'));
      assert(p.prompt.includes('FACTO DESTINO'));
      assert(!p.prompt.includes('FACTO SOMENTE ORIGEM'));
      assert(p.prompt.includes('memoria_propor'));
    }
  } finally {
    await tmp.limpar();
  }
});

test('busca devolve no maximo 50 chats e nao encontra segredos mascarados', async () => {
  const tmp = await temporario();
  try {
    const db = await banco(tmp.pasta),
      s = await sala(db);
    for (let i = 0; i < 55; i++) {
      const chat = await s.chats.criar('Pessoa');
      await s.chats.renomear(chat.id, `Publicacao ${i}`);
    }
    assert.equal((await s.listarChats('publicacao')).length, 50);
    const segredo = 'sk-' + 'Q'.repeat(32);
    s.enviar(`Credencial ${segredo}`, []);
    await s.esperar();
    assert.equal((await s.listarChats(segredo)).length, 0);
  } finally {
    await tmp.limpar();
  }
});

test('menu e exportacao leem o chat durante execucao; Novo chat cancela sem misturar historicos', async () => {
  const tmp = await temporario();
  try {
    const db = await banco(tmp.pasta),
      s = new Sala('s', null, 'Avulsa', db);
    const p = provedor();
    let iniciou!: () => void;
    const pronto = new Promise<void>((r) => {
      iniciou = r;
    });
    p.executar = async (_, e, sinal) => {
      iniciou();
      await new Promise<void>((r) => sinal.addEventListener('abort', () => r(), { once: true }));
      e.fala('Fim da conversa anterior');
    };
    s.registrar(p);
    await s.iniciar();
    const anterior = s.chat.id;
    s.enviar('@codex aguardar', []);
    await pronto;
    assert.equal((await s.listarChats())[0].id, anterior);
    assert((await s.mensagensChat(anterior)).some((m) => m.texto === '@codex aguardar'));
    await s.novoChat();
    assert.notEqual(s.chat.id, anterior);
    assert.equal(s.mensagens.length, 0);
    assert((await s.mensagensChat(anterior)).some((m) => m.texto === 'Fim da conversa anterior'));
  } finally {
    await tmp.limpar();
  }
});
