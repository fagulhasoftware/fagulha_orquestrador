import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { EventEmitter } from 'node:events';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import {
  GestorLogin,
  ErroLogin,
  validarChave,
  validarLinkLogin,
  lerSaidaLogin,
  contaMascarada,
  opcoesLogin,
  rodarLogin,
  type TipoChave,
  type DependenciasLogin,
} from '../src/providers/login';
import { agentePadrao, type Provedor, type Segredos } from '../src/providers/tipos';
import { ProvedorCli } from '../src/providers/cli';
import { ProvedorApi } from '../src/providers/api';
import { criarProvedorManifesto, validarManifesto } from '../src/providers/manifestos';
import { validarMensagem } from '../src/core/protocolo';
import { mascarar } from '../src/core/seguranca';
import { VERSAO_PROTOCOLO, type DoHost, type ProgressoLogin } from '../src/shared/protocolo';
import { temporario, banco } from './apoio';
import { Sala } from '../src/core/sala';
import { matarArvore } from '../src/providers/processo';

const chaves: Record<TipoChave, string> = {
  openai: 'sk-fixture-openai-apenas-teste-1234',
  anthropic: 'sk-ant-fixture-anthropic-apenas-teste-2345',
  // Compoe uma fixture valida sem versionar um literal com formato de chave completa.
  gemini: ['AIza', 'FixtureGeminiApenasTesteNaoReal3456'].join(''),
  compativel: 'fixture-compativel-apenas-teste-4567',
};
function segredosMemoria() {
  const valores = new Map<string, string>();
  const segredos: Segredos = {
    get: async (id) => valores.get(id),
    store: async (id, valor) => {
      valores.set(id, valor);
    },
    delete: async (id) => {
      valores.delete(id);
    },
  };
  return { valores, segredos };
}
function fixture(
  id = 'openai-api',
  tipo: TipoChave = 'openai',
  extras: Partial<DependenciasLogin> = {},
) {
  const memoria = segredosMemoria();
  const eventos: DoHost[] = [];
  const auditoria: string[] = [];
  const links: string[] = [];
  const p: Provedor = {
    agente: agentePadrao(id, id, 'api', 'azul'),
    detectar: async () => ({ instalado: true }),
    estadoLogin: async () => 'conectado',
    login: async () => {},
    executar: async () => {},
    autenticacao: { segredos: memoria.segredos, segredoId: `fagulha.api.${id}`, tipoChave: tipo },
  };
  p.agente.opcoesLogin = opcoesLogin(id);
  const gestor = new GestorLogin({
    provedor: (agente) => (agente === id ? p : undefined),
    emitir: (evento) => eventos.push(structuredClone(evento)),
    abrir: async (url) => {
      links.push(url);
    },
    auditar: async (resumo) => {
      auditoria.push(resumo);
    },
    ...extras,
  });
  const progressos = () =>
    eventos
      .filter((e): e is Extract<DoHost, { tipo: 'login' }> => e.tipo === 'login')
      .map((e) => e.progresso);
  return { ...memoria, eventos, auditoria, links, p, gestor, progressos };
}
async function servidorHttp(
  status: number | 'timeout',
  verificar?: (headers: import('node:http').IncomingHttpHeaders) => void,
) {
  let chamadas = 0;
  const servidor = createServer((req, res) => {
    chamadas++;
    verificar?.(req.headers);
    assert.equal(req.method, 'GET');
    assert.equal(req.url, '/models');
    if (status === 'timeout') return;
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: [] }));
  });
  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(servidor.address() as import('node:net').AddressInfo).port}`;
  return {
    base,
    chamadas: () => chamadas,
    fechar: async () => {
      servidor.closeAllConnections();
      await new Promise<void>((r) => servidor.close(() => r()));
    },
  };
}

for (const tipo of ['openai', 'anthropic', 'gemini', 'compativel'] as TipoChave[]) {
  for (const status of [200, 401, 403, 'timeout'] as const) {
    test(`login ${tipo}: HTTP ${status}, uma consulta gratuita, gravação só após sucesso`, async () => {
      const servidor = await servidorHttp(status, (headers) => {
        if (tipo === 'anthropic') {
          assert.equal(headers['x-api-key'], chaves[tipo]);
          assert.equal(headers['anthropic-version'], '2023-06-01');
        } else if (tipo === 'gemini') assert.equal(headers['x-goog-api-key'], chaves[tipo]);
        else assert.equal(headers.authorization, `Bearer ${chaves[tipo]}`);
      });
      const id =
        tipo === 'anthropic'
          ? 'anthropic'
          : tipo === 'gemini'
            ? 'gemini-api'
            : tipo === 'compativel'
              ? 'openai-compativel'
              : 'openai-api';
      const f = fixture(id, tipo, {
        validar: (t, c, o) =>
          validarChave(t, c, {
            ...o,
            endpointTeste: tipo === 'compativel' ? undefined : `${servidor.base}/models`,
            timeoutMs: 60,
          }),
      });
      f.p.autenticacao!.salvarBaseUrl = async () => {};
      try {
        await f.gestor.chave(id, chaves[tipo], servidor.base);
        assert.equal(servidor.chamadas(), 1);
        const ultimo = f.progressos().at(-1)!;
        assert.equal(ultimo.etapa, status === 200 ? 'conectado' : 'erro');
        assert.equal(f.valores.has(`fagulha.api.${id}`), status === 200);
        if (status === 200) assert.equal(ultimo.conta, `chave ...${chaves[tipo].slice(-4)}`);
        if (status === 401 || status === 403)
          assert.equal(ultimo.mensagem, 'Chave recusada pelo provedor');
        assert(
          !JSON.stringify({ eventos: f.eventos, auditoria: f.auditoria }).includes(chaves[tipo]),
        );
        assert.deepEqual(f.auditoria, [
          `login ${id} chave ${status === 200 ? 'conectado' : 'erro'}`,
        ]);
      } finally {
        await servidor.fechar();
      }
    });
  }
  test(`${tipo}: formato inválido recusado antes da rede`, async () => {
    const servidor = await servidorHttp(200);
    try {
      await assert.rejects(
        validarChave(tipo, 'inválida\n', { endpointTeste: `${servidor.base}/models` }),
        /formato/,
      );
      assert.equal(servidor.chamadas(), 0);
    } finally {
      await servidor.fechar();
    }
  });
}

test('sem redirecionamento da chave para outro servidor', async () => {
  let destinoChamado = false;
  const destino = createServer((_req, res) => {
    destinoChamado = true;
    res.end();
  });
  await new Promise<void>((r) => destino.listen(0, '127.0.0.1', r));
  const origem = createServer((_req, res) => {
    res.writeHead(302, { location: `http://127.0.0.1:${(destino.address() as any).port}/models` });
    res.end();
  });
  await new Promise<void>((r) => origem.listen(0, '127.0.0.1', r));
  try {
    await assert.rejects(
      validarChave('openai', chaves.openai, {
        endpointTeste: `http://127.0.0.1:${(origem.address() as any).port}/models`,
      }),
    );
    assert.equal(destinoChamado, false);
  } finally {
    origem.closeAllConnections();
    destino.closeAllConnections();
    await Promise.all([
      new Promise<void>((r) => origem.close(() => r())),
      new Promise<void>((r) => destino.close(() => r())),
    ]);
  }
});

test('parser: URLs Claude/Codex, ANSI, código real de dispositivo e sem código', () => {
  assert.deepEqual(
    lerSaidaLogin(
      'Browser didn’t open? Use:\nhttps://claude.ai/oauth/authorize?client_id=fixture&state=abc\n',
    ),
    {
      url: 'https://claude.ai/oauth/authorize?client_id=fixture&state=abc',
      codigo: undefined,
    },
  );
  assert.deepEqual(
    lerSaidaLogin(
      'Open your browser:\nhttps://auth.openai.com/oauth/authorize?response_type=code\n',
    ),
    {
      url: 'https://auth.openai.com/oauth/authorize?response_type=code',
      codigo: undefined,
    },
  );
  assert.deepEqual(
    lerSaidaLogin(
      '\n1. Open this link in your browser\n  \x1b[94mhttps://auth.openai.com/codex/device\x1b[0m\n\n2. Enter this one-time code (expires in 15 minutes)\n  \x1b[94mABCD-1234\x1b[0m\n',
    ),
    {
      url: 'https://auth.openai.com/codex/device',
      codigo: 'ABCD-1234',
    },
  );
  assert.equal(lerSaidaLogin('Device code: XY12-AB34').codigo, 'XY12-AB34');
  assert.equal(lerSaidaLogin('No login instructions').url, undefined);
  assert.equal(contaMascarada('nathan@example.com'), 'n***@example.com');
  assert.equal(contaMascarada(undefined, 'max'), 'max');
  assert.equal(contaMascarada(undefined, chaves.openai), undefined);
});

test('links: somente HTTPS, domínios exatos/subdomínios e URL vigente do fluxo', () => {
  for (const dominio of [
    'anthropic.com',
    'console.anthropic.com',
    'claude.ai',
    'claude.com',
    'openai.com',
    'platform.openai.com',
    'chatgpt.com',
    'auth.openai.com',
    'aistudio.google.com',
    'google.com',
    'accounts.google.com',
  ])
    assert.equal(validarLinkLogin(`https://${dominio}/login`), `https://${dominio}/login`);
  for (const url of [
    'http://claude.ai/login',
    'javascript:alert(1)',
    'file:///x',
    'https://claude.ai.evil.test/',
    'https://evilopenai.com/',
    'https://openai.com@evil.test/',
    'https://user:password@claude.ai/',
    'https://auth.openai.com:8443/',
    'https://example.com/',
  ])
    assert.throws(() => validarLinkLogin(url));
  assert.equal(
    validarLinkLogin('https://sso.example.test/specific', ['https://sso.example.test/specific']),
    'https://sso.example.test/specific',
  );
  assert.throws(() =>
    validarLinkLogin('https://sso.example.test/other', ['https://sso.example.test/specific']),
  );
  assert.throws(() => validarLinkLogin('http://example.test/', ['http://example.test/']));
});

for (const [id, metodo, variante, esperado] of [
  ['claude', 'navegador', 'claudeai', ['auth', 'login', '--claudeai']],
  ['claude', 'navegador', 'console', ['auth', 'login', '--console']],
  ['codex', 'navegador', undefined, ['login']],
  ['codex', 'dispositivo', undefined, ['login', '--device-auth']],
] as const) {
  test(`${id}: login ${metodo}/${variante ?? 'padrão'}, progresso e confirmação oficial`, async () => {
    const f = fixture(id);
    f.p.autenticacao!.comando = async (args, sinal, saida) => {
      assert.deepEqual(args, esperado);
      assert.equal(sinal.aborted, false);
      saida?.('https://auth.openai.com/oauth/');
      assert.equal(f.links.length, 0);
      saida?.('authorize?state=fixture\n');
      if (metodo === 'dispositivo') saida?.('Code: ABCD-1234\n');
      return '';
    };
    let confirmacoes = 0;
    f.p.estadoLogin = async () => {
      confirmacoes++;
      f.p.agente.conta = 'n***@example.com';
      return 'conectado';
    };
    await f.gestor.iniciar(id, metodo, variante);
    assert.equal(confirmacoes, 1);
    assert.equal(f.links.length, 1);
    const progresso = f.progressos().find((p) => p.url)!;
    assert.equal(
      progresso.etapa,
      metodo === 'dispositivo' ? 'codigo_dispositivo' : 'aguardando_navegador',
    );
    assert.equal(progresso.codigo, metodo === 'dispositivo' ? 'ABCD-1234' : undefined);
    assert.equal(f.progressos().at(-1)!.etapa, 'conectado');
    assert.equal(f.progressos().at(-1)!.conta, 'n***@example.com');
    assert.equal(f.gestor.progresso().length, 0);
  });
}

test('Codex: fallback TTY usa device-auth, nunca terminal', async () => {
  const f = fixture('codex');
  const comandos: string[][] = [];
  f.p.autenticacao!.comando = async (args, _sinal, saida) => {
    comandos.push(args);
    if (comandos.length === 1) throw new ErroLogin('Este CLI exige um terminal interativo.');
    saida?.('https://auth.openai.com/codex/device\nCode: ABCD-1234\n');
    return '';
  };
  await f.gestor.iniciar('codex', 'navegador');
  assert.deepEqual(comandos, [['login'], ['login', '--device-auth']]);
  assert(f.progressos().some((p) => p.etapa === 'codigo_dispositivo'));
});

test('login não confirmado/variante inválida vira erro; URL maliciosa não é aberta', async () => {
  const f = fixture('claude');
  let chamadas = 0;
  f.p.autenticacao!.comando = async (_a, _s, saida) => {
    chamadas++;
    saida?.('https://evil.example.test/oauth/login\n');
    return '';
  };
  f.p.estadoLogin = async () => 'desconectado';
  await f.gestor.iniciar('claude', 'navegador', 'console');
  assert.equal(f.links.length, 0);
  assert.equal(f.progressos().at(-1)!.etapa, 'erro');
  await f.gestor.iniciar('claude', 'navegador', '--evil');
  assert.equal(chamadas, 1);
  await assert.rejects(f.gestor.abrir('https://evil.example.test/'));
});

test('cancelamento interrompe validação, impede gravação e mantém chave anterior', async () => {
  let iniciou!: () => void;
  const pronto = new Promise<void>((r) => {
    iniciou = r;
  });
  const f = fixture('openai-api', 'openai', {
    validar: async (_t, _c, o) => {
      iniciou();
      await once(o!.sinal!, 'abort');
      throw new Error('cancelado');
    },
  });
  f.valores.set('fagulha.api.openai-api', 'credencial-anterior-ficticia');
  const tarefa = f.gestor.chave('openai-api', chaves.openai);
  await pronto;
  f.gestor.cancelar('openai-api');
  await tarefa;
  assert.equal(f.valores.get('fagulha.api.openai-api'), 'credencial-anterior-ficticia');
  assert.equal(f.progressos().at(-1)!.etapa, 'cancelado');
  assert.deepEqual(f.auditoria, ['login openai-api chave cancelado']);
});

test('cancelamento durante store desfaz gravação tardia antes do próximo login', async () => {
  let iniciou!: () => void;
  let liberar!: () => void;
  const pronto = new Promise<void>((r) => {
    iniciou = r;
  });
  const espera = new Promise<void>((r) => {
    liberar = r;
  });
  const f = fixture('openai-api', 'openai', { validar: async () => {} });
  f.p.autenticacao!.segredos.store = async (id, chave) => {
    iniciou();
    await espera;
    f.valores.set(id, chave);
  };
  const tarefa = f.gestor.chave('openai-api', chaves.openai);
  await pronto;
  f.gestor.cancelar('openai-api');
  liberar();
  await tarefa;
  assert.equal(f.valores.size, 0);
  assert.equal(f.progressos().at(-1)!.etapa, 'cancelado');
});

test('timeout de login em segundo plano interrompe processo e informa erro', async () => {
  const f = fixture('codex', 'openai', { timeoutMs: 30 });
  f.p.autenticacao!.comando = async (_a, sinal) => {
    await once(sinal, 'abort');
    throw new Error('interrompido');
  };
  await f.gestor.iniciar('codex', 'navegador');
  assert.equal(f.progressos().at(-1)!.etapa, 'erro');
  assert.match(f.progressos().at(-1)!.mensagem!, /5 minutos/);
});

test('Codex com chave: valida antes, passa somente por stdin e confirma login antes de gravar', async () => {
  const ordem: string[] = [];
  const f = fixture('codex', 'openai', {
    validar: async () => {
      ordem.push('validar');
    },
  });
  f.p.autenticacao!.comando = async (args, _sinal, _saida, stdin) => {
    ordem.push('comando');
    assert.deepEqual(args, ['login', '--with-api-key']);
    assert.equal(stdin, `${chaves.openai}\n`);
    assert(!args.join(' ').includes(chaves.openai));
    return '';
  };
  f.p.estadoLogin = async () => {
    ordem.push('status');
    assert.equal(f.valores.size, 0);
    return 'conectado';
  };
  await f.gestor.chave('codex', chaves.openai);
  assert.deepEqual(ordem, ['validar', 'comando', 'status']);
  assert.equal(f.valores.get('fagulha.api.codex'), chaves.openai);
  assert(!JSON.stringify(f.eventos).includes(chaves.openai));
});

for (const id of ['claude', 'codex', 'gemini-api'])
  test(`${id}: logout remove segredo e usa comando oficial quando aplicável`, async () => {
    const f = fixture(id);
    f.valores.set(`fagulha.api.${id}`, chaves.openai);
    f.p.agente.conta = 'conta anterior';
    const args: string[][] = [];
    if (id !== 'gemini-api')
      f.p.autenticacao!.comando = async (a) => {
        args.push(a);
        return '';
      };
    await f.gestor.logout(id);
    assert.equal(f.valores.size, 0);
    assert.equal(f.p.agente.login, 'desconectado');
    assert.equal(f.p.agente.conta, undefined);
    assert.deepEqual(
      args,
      id === 'claude' ? [['auth', 'logout']] : id === 'codex' ? [['logout']] : [],
    );
    assert.deepEqual(f.auditoria, [`login ${id} logout desconectado`]);
  });

test('stderr com chave não volta ao webview nem à auditoria; exceções são mascaradas', async () => {
  const f = fixture('codex', 'openai', { validar: async () => {} });
  f.p.autenticacao!.comando = async () => {
    throw new ErroLogin(`Falha: ${chaves.openai}`);
  };
  await f.gestor.chave('codex', chaves.openai);
  assert(!JSON.stringify({ eventos: f.eventos, auditoria: f.auditoria }).includes(chaves.openai));
  assert.equal(f.valores.size, 0);
  assert(!mascarar(`stderr: ${chaves.openai}`).includes(chaves.openai));
});

test('falha de rede não grava chave; falha de configuração restaura a credencial anterior', async () => {
  const f = fixture('openai-api', 'openai', {
    validar: async () => {
      throw new Error('rede indisponível');
    },
  });
  await f.gestor.chave('openai-api', chaves.openai);
  assert.equal(f.valores.size, 0);
  assert.equal(f.progressos().at(-1)!.etapa, 'erro');
  const api = fixture('openai-compativel', 'compativel', { validar: async () => {} });
  api.valores.set('fagulha.api.openai-compativel', 'credencial-anterior-ficticia');
  api.p.autenticacao!.salvarBaseUrl = async () => {
    throw new Error('configuração somente leitura');
  };
  await api.gestor.chave('openai-compativel', chaves.compativel, 'https://api.example.test/v1');
  assert.equal(api.valores.get('fagulha.api.openai-compativel'), 'credencial-anterior-ficticia');
  assert.equal(api.progressos().at(-1)!.etapa, 'erro');
});

test('endereço compatível inválido não recebe a chave e não modifica configuração', async () => {
  let consultas = 0;
  const f = fixture('openai-compativel', 'compativel', {
    validar: async () => {
      consultas++;
    },
  });
  for (const url of [
    'http://remote.example.test/v1',
    'https://user:password@api.example.test/',
    'https://api.example.test/?key=123',
  ]) {
    await f.gestor.chave('openai-compativel', chaves.compativel, url);
    assert.equal(f.progressos().at(-1)!.etapa, 'erro');
  }
  assert.equal(consultas, 0);
  assert.equal(f.valores.size, 0);
});

test('segundo login substitui fluxo anterior; fechamento cancela todos os fluxos pendentes', async () => {
  let iniciou!: () => void;
  const pronto = new Promise<void>((r) => {
    iniciou = r;
  });
  let chamadas = 0;
  const f = fixture('openai-api', 'openai', {
    validar: async (_t, _c, o) => {
      chamadas++;
      if (chamadas === 1) {
        iniciou();
        await once(o!.sinal!, 'abort');
        throw new Error('cancelado');
      }
    },
  });
  const anterior = f.gestor.chave('openai-api', chaves.openai);
  await pronto;
  const seguinte = f.gestor.chave('openai-api', `${chaves.openai}-nova`);
  await Promise.all([anterior, seguinte]);
  assert.equal(f.valores.get('fagulha.api.openai-api'), `${chaves.openai}-nova`);
  assert.deepEqual(f.auditoria, [
    'login openai-api chave cancelado',
    'login openai-api chave conectado',
  ]);
  const cli = fixture('codex');
  let comandoIniciou!: () => void;
  const ativo = new Promise<void>((r) => {
    comandoIniciou = r;
  });
  cli.p.autenticacao!.comando = async (_a, sinal) => {
    comandoIniciou();
    await once(sinal, 'abort');
    throw new Error('cancelado');
  };
  const tarefa = cli.gestor.iniciar('codex', 'navegador');
  await ativo;
  await cli.gestor.finalizar();
  await tarefa;
  assert.equal(cli.progressos().at(-1)!.etapa, 'cancelado');
  assert.equal(cli.gestor.progresso().length, 0);
});

test('CLI fixture sem rede: stdout/stderr, confirmação --json, conta mascarada e nenhum terminal', async () => {
  const tmp = await temporario();
  try {
    const script = join(tmp.pasta, 'cli-login.cjs');
    const registro = join(tmp.pasta, 'comandos.jsonl');
    await writeFile(
      script,
      `const fs=require('fs');const a=process.argv.slice(2);
      fs.appendFileSync(${JSON.stringify(registro)},JSON.stringify(a)+'\\n');
      if(a[0]==='--version')console.log('fixture 1');
      else if(a[1]==='login')process.stderr.write('https://claude.ai/oauth/authorize?state=fixture\\n');
      else if(a[1]==='status')console.log(JSON.stringify({loggedIn:true,email:'nathan@example.com',subscriptionType:'max'}));`,
    );
    const f = fixture('claude');
    const p = new ProvedorCli(
      'claude',
      async () => {
        assert.fail('Terminal proibido');
      },
      script,
      tmp.pasta,
      f.segredos,
    );
    await p.detectar();
    const gestor = new GestorLogin({
      provedor: () => p,
      emitir: (e) => f.eventos.push(structuredClone(e)),
      abrir: async (u) => {
        f.links.push(u);
      },
      auditar: async () => {},
    });
    await gestor.iniciar('claude', 'navegador', 'claudeai');
    assert.equal(p.agente.conta, 'n***@example.com');
    const comandos = (await readFile(registro, 'utf8'))
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    assert(
      comandos.some((a) => JSON.stringify(a) === JSON.stringify(['auth', 'status', '--json'])),
    );
    assert.equal(f.links.length, 1);
    await assert.rejects(p.login(), /painel/);
    assert(!JSON.stringify(f.eventos).includes('nathan@example.com'));
  } finally {
    await tmp.limpar();
  }
});

test('cancelar encerra processo fixture sem executar CLIs reais', async () => {
  const tmp = await temporario();
  try {
    const script = join(tmp.pasta, 'cancelar.cjs');
    await writeFile(script, `console.log('processo:'+process.pid);setInterval(()=>{},1000);`);
    const controle = new AbortController();
    let filho = 0;
    let iniciou!: () => void;
    const pronto = new Promise<void>((r) => {
      iniciou = r;
    });
    const tarefa = rodarLogin(process.execPath, [script], {
      sinal: controle.signal,
      saida: (t) => {
        const pid = t.match(/processo:(\d+)/)?.[1];
        if (pid) {
          filho = Number(pid);
          iniciou();
        }
      },
    });
    await pronto;
    controle.abort();
    await assert.rejects(tarefa);
    if (process.platform === 'win32') assert.throws(() => process.kill(filho, 0));
    else {
      // Em POSIX, um filho terminado pode permanecer zumbi brevemente após SIGTERM.
      const verificar = spawn('ps', ['-p', String(filho), '-o', 'stat=']);
      let estado = '';
      verificar.stdout.on('data', (d) => {
        estado += d;
      });
      await once(verificar, 'close');
      assert(!estado.trim() || estado.includes('Z'));
    }
  } finally {
    await tmp.limpar();
  }
});

test('Windows: encerramento solicita taskkill /T /F para a árvore, janela oculta e PID específico', () => {
  if (process.platform !== 'win32') return;
  let chamado = false;
  matarArvore(12345, ((cmd: string, args: string[], opcoes: unknown) => {
    chamado = true;
    assert.equal(cmd, 'taskkill.exe');
    assert.deepEqual(args, ['/PID', '12345', '/T', '/F']);
    assert.deepEqual(opcoes, { windowsHide: true, stdio: 'ignore' });
    return new EventEmitter();
  }) as typeof spawn);
  assert.equal(chamado, true);
});

test('Ollama verifica /api/tags; opções dos agentes e manifesto compatível seguem contrato v2', async () => {
  assert.equal(VERSAO_PROTOCOLO, 2);
  const memoria = segredosMemoria();
  const servidor = createServer((req, res) => {
    assert.equal(req.url, '/api/tags');
    res.end('{"models":[]}');
  });
  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
  const baseUrl = `http://127.0.0.1:${(servidor.address() as any).port}`;
  try {
    const ollama = new ProvedorApi('ollama', memoria.segredos, () => ({ baseUrl }));
    assert.deepEqual(ollama.agente.opcoesLogin, []);
    assert.equal(await ollama.estadoLogin(), 'conectado');
    const m = criarProvedorManifesto(
      validarManifesto({ id: 'meu-api', nick: 'Meu API', tipo: 'openai-compativel', baseUrl }),
      memoria.segredos,
      async () => {
        assert.fail('Terminal proibido');
      },
      async () => undefined,
    );
    assert.equal(m.agente.opcoesLogin[0].variante, 'com_baseUrl');
    assert.equal(
      new ProvedorApi('openai-api', memoria.segredos, () => ({})).agente.opcoesLogin[0].linkChave,
      'https://platform.openai.com/api-keys',
    );
  } finally {
    servidor.closeAllConnections();
    await new Promise<void>((r) => servidor.close(() => r()));
  }
  const ollama = new ProvedorApi('ollama', memoria.segredos, () => ({ baseUrl }));
  assert.equal(await ollama.estadoLogin(), 'desconectado');
});

test('mensagens v2 válidas, agenteLogin legado e campos adicionais recusados', () => {
  for (const m of [
    { tipo: 'loginIniciar', id: 'claude', metodo: 'navegador', variante: 'console' },
    {
      tipo: 'loginChave',
      id: 'openai-compativel',
      chave: chaves.compativel,
      baseUrl: 'https://api.example.com/v1',
    },
    { tipo: 'loginCancelar', id: 'claude' },
    { tipo: 'logout', id: 'claude' },
    { tipo: 'abrirLinkLogin', url: 'https://claude.ai/login' },
  ])
    assert.deepEqual(validarMensagem(m), m);
  assert.throws(() => validarMensagem({ tipo: 'agenteLogin', id: 'claude' }));
  assert.throws(() => validarMensagem({ tipo: 'loginIniciar', id: 'claude', metodo: 'terminal' }));
  assert.throws(() =>
    validarMensagem({ tipo: 'loginChave', id: 'claude', chave: chaves.openai, extra: true }),
  );
});

test('entrada curta inválida mantém mensagem clara, sem contaminar a máscara de segredos', async () => {
  const f = fixture('openai-api', 'openai');
  await f.gestor.chave('openai-api', 'a');
  assert.equal(f.progressos().at(-1)!.etapa, 'erro');
  assert.match(f.progressos().at(-1)!.mensagem!, /formato da chave é inválido/);
  assert.equal(mascarar('Mensagem clara para o usuário.'), 'Mensagem clara para o usuário.');
});

test('persistência real de sala/auditoria nunca recebe a chave ou saída bruta', async () => {
  const tmp = await temporario();
  try {
    const storage = await banco(tmp.pasta);
    const sala = new Sala('teste-login', tmp.pasta, 'Teste', storage);
    const f = fixture('openai-api', 'openai', { validar: async () => {} });
    sala.registrar(f.p);
    const gestor = new GestorLogin({
      provedor: (id) => sala.provedores.get(id),
      emitir: (e) => sala.emitir(e),
      abrir: async () => {},
      validar: async () => {},
      auditar: async (resumo) => {
        await storage.gravar('auditoria', sala.id, 'login', { resumo });
      },
    });
    await gestor.chave('openai-api', chaves.openai);
    await sala.salvar();
    await sala.esperar();
    for (const tabela of ['mensagens', 'auditoria', 'provedores', 'acoes'] as const)
      assert(!JSON.stringify(await storage.listar(tabela)).includes(chaves.openai));
    assert.deepEqual(await storage.listar('mensagens'), []);
    assert.deepEqual(await storage.listar('auditoria'), [
      { resumo: 'login openai-api chave conectado' },
    ]);
    await storage.finalizar();
  } finally {
    await tmp.limpar();
  }
});
