import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from '@iarna/toml';
import { ProvedorCli, montarArgumentos } from '../src/providers/cli';
import { isolamentoMcp, lerMcpJson, tomlString } from '../src/providers/codex-mcp';
import type { EventosProvedor, PedidoExecucao } from '../src/providers/tipos';
import { temporario } from './apoio';

const servidores = [
  {
    name: 'code-review',
    enabled: true,
    transport: {
      type: 'stdio',
      command: 'C:\\Program Files\\Codex Tools\\review.exe',
      args: ['C:\\plugins\\code review\\main.js', 'aspas " e barra \\ e controle \u0001'],
      env: { SECRET: 'fixture-env-confidencial', DEBUG: '1' },
      env_vars: ['SECRET'],
    },
  },
  {
    name: 'plugin.http',
    enabled: true,
    transport: {
      type: 'streamable_http',
      url: 'https://example.invalid/mcp',
      http_headers: { Authorization: 'fixture-header-confidencial' },
      bearer_token_env_var: 'fixture-bearer-confidencial',
    },
  },
  { name: 'desligado', enabled: false, transport: { type: 'desconhecido' } },
  { name: 'fagulha_orquestrador', enabled: true, transport: { type: 'desconhecido' } },
];

function configuracoes(args: string[]): any {
  // A CLI separa o caminho por pontos e interpreta somente o valor como TOML.
  const resultado: any = {};
  for (let i = 0; i < args.length; i++)
    if (args[i] === '-c') {
      const override = args[++i];
      const separador = override.indexOf('=');
      const caminho = override.slice(0, separador).split('.');
      const valor = parse('valor=' + override.slice(separador + 1)).valor;
      let tabela = resultado;
      for (const chave of caminho.slice(0, -1)) tabela = tabela[chave] ??= {};
      tabela[caminho.at(-1)!] = valor;
    }
  return resultado;
}

test('overrides de plugin sao TOML valido, nomes com ponto sao literais e segredos nao sao copiados', () => {
  for (const sessao of [undefined, 'retomada']) {
    const args = montarArgumentos(
      'codex',
      'leitura_escrita',
      'manual',
      sessao,
      undefined,
      'C:\\Program Files\\Fagulha\\mcp.js',
      'C:\\Program Files\\node.exe',
      lerMcpJson(JSON.stringify(servidores)),
    );
    const config = configuracoes(args);
    assert.deepEqual(config.mcp_servers['code-review'], {
      command: servidores[0].transport.command,
      args: servidores[0].transport.args,
      enabled: false,
    });
    assert.deepEqual(config.mcp_servers['plugin.http'], {
      url: 'https://example.invalid/mcp',
      enabled: false,
    });
    assert.equal(config.mcp_servers.desligado, undefined);
    assert.equal(config.mcp_servers.fagulha_orquestrador.enabled, true);
    assert.equal(config.mcp_servers.fagulha_orquestrador.command, 'C:\\Program Files\\node.exe');
    assert.deepEqual(config.mcp_servers.fagulha_orquestrador.args, [
      'C:\\Program Files\\Fagulha\\mcp.js',
    ]);
    assert(!args.join(' ').includes('confidencial'));
    assert(!JSON.stringify(lerMcpJson(JSON.stringify(servidores))).includes('confidencial'));
  }
  assert.equal(
    parse('valor=' + tomlString('"\\\t\n\r\b\f\u0000\u007f')).valor,
    '"\\\t\n\r\b\f\u0000\u007f',
  );
});

test('validacao rejeita nome, command, args, URL e transportes invalidos sem criar overrides', () => {
  const invalidos = [
    { name: 'nome/invalido', transport: { type: 'stdio', command: 'node' } },
    { name: 'command-vazio', transport: { type: 'stdio', command: ' ' } },
    { name: 'args-invalidos', transport: { type: 'stdio', command: 'node', args: [4] } },
    { name: 'arg-vazio', transport: { type: 'stdio', command: 'node', args: [''] } },
    {
      name: 'arg-secreto',
      transport: { type: 'stdio', command: 'node', args: ['--token', 'fixture-secreto'] },
    },
    {
      name: 'arg-env',
      transport: {
        type: 'stdio',
        command: 'node',
        args: ['fixture-secreto'],
        env: { KEY: 'fixture-secreto' },
      },
    },
    {
      name: 'url-token',
      transport: { type: 'http', url: 'https://example.invalid?access_token=fixture-secreto' },
    },
    { name: 'url-invalida', transport: { type: 'http', url: 'file:///tmp/mcp' } },
    {
      name: 'url-credencial',
      transport: { type: 'http', url: 'https://usuario:senha@example.invalid' },
    },
    { name: 'desconhecido', transport: { type: 'custom', command: 'node' } },
  ];
  const lista = lerMcpJson(JSON.stringify(invalidos));
  assert.throws(() => isolamentoMcp(lista, 'manual'), /Manual exige isolamento/);
  for (const nivel of ['parcial', 'total'] as const) {
    const plano = isolamentoMcp(lista, nivel);
    assert.deepEqual(plano.args, []);
    assert.deepEqual(
      plano.ativos,
      invalidos.map((m) => m.name),
    );
  }
  for (const type of ['http', 'sse', 'streamable_http']) {
    const plano = isolamentoMcp(
      lerMcpJson(
        JSON.stringify([{ name: type, transport: { type, url: 'http://example.invalid/mcp' } }]),
      ),
      'manual',
    );
    assert.equal(configuracoes(plano.args).mcp_servers[type].enabled, false);
  }
});

async function fixture(opcoes: Record<string, unknown> = {}) {
  const tmp = await temporario();
  const homeAnterior = process.env.CODEX_HOME;
  const home = join(tmp.pasta, 'codex-home');
  await mkdir(home);
  process.env.CODEX_HOME = home;
  const config = join(home, 'config.toml');
  await writeFile(config, '# perfil sintetico, sem credenciais\n');
  const op = join(tmp.pasta, 'opcoes.json'),
    registro = join(tmp.pasta, 'registro.json');
  await writeFile(op, JSON.stringify({ servidores, ...opcoes }));
  const mock = join(tmp.pasta, 'codex.cjs');
  await writeFile(
    mock,
    `
    const fs = require('node:fs'); const args = process.argv.slice(2);
    const op = JSON.parse(fs.readFileSync(${JSON.stringify(op)}, 'utf8'));
    if (args[0] === '--version') { console.log('fixture 0.159.2'); process.exit(0); }
    const arquivo = ${JSON.stringify(registro)};
    const log = fs.existsSync(arquivo) ? JSON.parse(fs.readFileSync(arquivo, 'utf8')) : {listas: [], execucoes: []};
    const avisar = () => {
      if (!op.aviso) return;
      const canal = op.avisoStdout ? process.stdout : process.stderr;
      canal.write('Codex is ignoring 2 unrecognized config');
      canal.write('uration settings:\\n  - features.rmcp_client\\n  - mcp\\n');
    };
    if (args[0] === 'mcp') {
      log.listas.push(args); fs.writeFileSync(arquivo, JSON.stringify(log)); avisar();
      if (op.fallback && args.includes('--json')) { console.error('unexpected argument --json'); process.exit(2); }
      console.log(op.fallback ? 'Name Command Args Env Cwd Status Auth\\ncode-review node - - - enabled Unsupported\\ndesligado node - - - disabled Unsupported\\n' : JSON.stringify(op.servidores));
    } else {
      log.execucoes.push(args); fs.writeFileSync(arquivo, JSON.stringify(log));
      const id = args[1] === 'resume' ? args[2] : 'sessao-' + log.execucoes.length;
      console.log(JSON.stringify({type: 'thread.started', thread_id: id}));
      avisar();
      if (op.aviso) console.log(JSON.stringify({type:'item.completed',item:{type:'error',message:'Codex is ignoring 2 unrecognized configuration settings: features.rmcp_client, mcp'}}));
      console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'resposta concluida'}}));
      if (op.falha) { console.error('falha real da fixture'); process.exitCode = 3; }
    }
  `,
  );
  const provedor = new ProvedorCli('codex', async () => {}, mock, join(tmp.pasta, 'scratch'));
  assert.equal((await provedor.detectar()).instalado, true);
  const pedido: PedidoExecucao = {
    prompt: 'teste local',
    projeto: tmp.pasta,
    modo: 'leitura_escrita',
    nivel: 'manual',
    ponte: {
      url: 'http://127.0.0.1:1',
      token: 'fixture',
      servidor: 'mcp.js',
      diretorio: join(tmp.pasta, 'ponte'),
    },
  };
  const avisos: string[] = [],
    erros: string[] = [],
    falas: string[] = [];
  const ev: EventosProvedor = {
    sessao: (id) => {
      pedido.sessao = id;
    },
    fala: (t) => falas.push(t),
    parcial: () => {},
    acao: () => {},
    sistema: (t) => avisos.push(t),
    erro: (t) => erros.push(t),
  };
  return {
    provedor,
    pedido,
    avisos,
    erros,
    falas,
    config,
    mock,
    executar: () => provedor.executar(pedido, ev, new AbortController().signal),
    log: async () => JSON.parse(await readFile(registro, 'utf8')),
    limpar: async () => {
      if (homeAnterior === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = homeAnterior;
      await tmp.limpar();
    },
  };
}

test('CLI ficticia: nova sessao e retomada isolam plugins, cache compartilhado e mtime invalida', async () => {
  const f = await fixture();
  try {
    await f.executar();
    await f.executar();
    const outro = new ProvedorCli('codex', async () => {}, f.mock);
    await outro.detectar();
    await outro.executar(
      f.pedido,
      { sessao: () => {}, fala: () => {}, parcial: () => {}, acao: () => {}, erro: () => {} },
      new AbortController().signal,
    );
    let log = await f.log();
    assert.equal(log.listas.length, 1);
    assert.deepEqual(log.listas[0], ['mcp', 'list', '--json']);
    assert.deepEqual(log.execucoes[1].slice(0, 3), ['exec', 'resume', 'sessao-1']);
    for (const args of log.execucoes) {
      assert.equal(configuracoes(args).mcp_servers['code-review'].enabled, false);
      assert(!args.join(' ').includes('confidencial'));
    }
    const futuro = new Date(Date.now() + 5000);
    await utimes(f.config, futuro, futuro);
    await f.executar();
    log = await f.log();
    assert.equal(log.listas.length, 2);
    assert.deepEqual(f.avisos, []);
  } finally {
    await f.limpar();
  }
});

test('CLI ficticia: Manual recusa desconhecido; Parcial/Total seguem com um aviso por sessao', async () => {
  const f = await fixture({
    servidores: [
      ...servidores,
      { name: 'plugin-desconhecido', enabled: true, transport: { type: 'custom' } },
    ],
  });
  try {
    await assert.rejects(f.executar(), /plugin-desconhecido.*Execucao recusada/);
    assert.equal((await f.log()).execucoes.length, 0);
    f.pedido.nivel = 'parcial';
    await f.executar();
    await f.executar();
    f.pedido.nivel = 'total';
    await f.executar();
    assert.equal(f.avisos.length, 1);
    assert.match(f.avisos[0], /plugin-desconhecido/);
    assert(
      !((await f.log()).execucoes[0] as string[]).some((a) => a.includes('plugin-desconhecido')),
    );
    f.pedido.sessao = undefined;
    await f.executar();
    assert.equal(f.avisos.length, 2);
    assert.deepEqual(f.erros, []);
  } finally {
    await f.limpar();
  }
});

test('CLI ficticia: --json indisponivel usa texto, Manual recusa e Parcial avisa sem override incompleto', async () => {
  const f = await fixture({ fallback: true });
  try {
    await assert.rejects(f.executar(), /code-review.*Manual exige isolamento/);
    f.pedido.nivel = 'parcial';
    await f.executar();
    await f.executar();
    const log = await f.log();
    assert.deepEqual(log.listas, [
      ['mcp', 'list', '--json'],
      ['mcp', 'list'],
    ]);
    assert.equal(f.avisos.length, 1);
    assert.match(f.avisos[0], /code-review/);
    assert.equal(configuracoes(log.execucoes[0]).mcp_servers['code-review'], undefined);
    assert.equal(configuracoes(log.execucoes[0]).mcp_servers.desligado, undefined);
  } finally {
    await f.limpar();
  }
});

for (const avisoStdout of [false, true])
  test(`CLI ficticia: aviso obsoleto em ${avisoStdout ? 'stdout' : 'stderr'} e JSON aparece uma vez e nao e erro`, async () => {
    const f = await fixture({ aviso: true, avisoStdout });
    try {
      const antes = await readFile(f.config, 'utf8');
      await f.executar();
      await f.executar();
      assert.equal(f.avisos.length, 1);
      assert.equal(
        f.avisos[0],
        'O Codex ignorou configuracoes obsoletas no seu config.toml: features.rmcp_client, mcp. Isso nao afeta o Orquestrador.',
      );
      assert.deepEqual(f.erros, []);
      assert.deepEqual(f.falas, ['resposta concluida', 'resposta concluida']);
      f.pedido.sessao = undefined;
      await f.executar();
      assert.equal(f.avisos.length, 2);
      assert.equal(await readFile(f.config, 'utf8'), antes);
    } finally {
      await f.limpar();
    }
  });

test('CLI ficticia: aviso informativo nao oculta falha real', async () => {
  const f = await fixture({ aviso: true, falha: true });
  try {
    await assert.rejects(f.executar(), /codigo 3: falha real da fixture/);
    assert.equal(f.avisos.length, 1);
  } finally {
    await f.limpar();
  }
});
