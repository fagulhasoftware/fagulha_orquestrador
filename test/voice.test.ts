import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import JSZip from 'jszip';
import { temporario } from './apoio';
import { validarMensagem } from '../src/core/protocolo';
import { VozLocal } from '../src/voice/voz';
import { estadoInicialVoz, padraoVoz, carregarConfiguracao } from '../src/voice/configuracao';
import {
  detectarVoz,
  analisarMicrofones,
  analisarVozes,
  argumentosMicrofones,
  type DetectadoVoz,
} from '../src/voice/deteccao';
import { InstaladorVoz, validarDownload, extrairBinarios } from '../src/voice/instalador';
import { argumentosGravacao } from '../src/voice/gravador';
import { argumentosTranscricao, normalizarMencoes } from '../src/voice/transcritor';
import { argumentosLeitura, textoParaLeitura, Leitor } from '../src/voice/leitor';
import {
  executarVoz,
  type FabricaProcesso,
  type ProcessoVoz,
  type ResultadoVoz,
} from '../src/voice/processo';
import { artefato, type ArtefatoVoz } from '../src/voice/catalogo';
import type { Agente, DoHost, Mensagem, ProgressoInstalacaoVoz } from '../src/shared/protocolo';
import type { ConfiguracaoVoz } from '../src/voice/configuracao';

const agentes = [
  { id: 'claude', nick: 'Claude', apelidos: ['claude'] },
  { id: 'codex', nick: 'Codex', apelidos: ['cx'] },
  { id: 'gemini', nick: 'Gemini', apelidos: ['ag', 'antigravity', 'gemini'] },
] as Agente[];
const fala = (id: string, texto = 'Resposta **final**'): Mensagem => ({
  id,
  sala: 'teste',
  quando: '2026-10-04',
  autor: 'Claude',
  tipo: 'fala',
  texto,
});
const pausa = (ms = 5) => new Promise((r) => setTimeout(r, ms));
async function esperar(condicao: () => boolean): Promise<void> {
  const limite = Date.now() + 3000;
  while (!condicao()) {
    if (Date.now() > limite) assert.fail('Condição não atingida');
    await pausa();
  }
}
function processoManual(): ProcessoVoz & {
  resolver: (r?: Partial<ResultadoVoz>) => void;
  entrada: string;
  cancelado: boolean;
} {
  let resolver!: (r: ResultadoVoz) => void;
  const p = {
    resultado: new Promise<ResultadoVoz>((r) => {
      resolver = r;
    }),
    entrada: '',
    cancelado: false,
    resolver(r: Partial<ResultadoVoz> = {}) {
      resolver({ codigo: 0, saida: '', erro: '', ...r });
    },
    escrever(texto: string) {
      p.entrada += texto;
    },
    fecharEntrada() {},
    cancelar() {
      p.cancelado = true;
      p.resolver({ codigo: null });
    },
  };
  return p;
}
function processosFicticios(
  opcoes: { falhar?: boolean; pendente?: boolean; ttsPendente?: boolean } = {},
) {
  const chamados: { comando: string; args: string[]; p: ReturnType<typeof processoManual> }[] = [];
  const fabrica: FabricaProcesso = (comando, args) => {
    const p = processoManual();
    chamados.push({ comando, args, p });
    const escrever = p.escrever;
    p.escrever = (texto) => {
      escrever(texto);
      if (comando === 'ffmpeg' && texto.includes('q'))
        void writeFile(args.at(-1)!, 'WAV FICTÍCIO').then(() => p.resolver());
    };
    if (comando === 'whisper-cli' && !opcoes.pendente) {
      void writeFile(
        args[args.indexOf('-of') + 1] + '.txt',
        'arroba claude veja arroba gemini',
      ).then(() =>
        p.resolver({ codigo: opcoes.falhar ? 1 : 0, erro: 'DADO PRIVADO DA TRANSCRIÇÃO' }),
      );
    } else if (comando !== 'ffmpeg' && comando !== 'whisper-cli' && !opcoes.ttsPendente)
      queueMicrotask(() => p.resolver());
    return p;
  };
  return { fabrica, chamados };
}
async function arquivos(pasta: string): Promise<string[]> {
  const lista = await readdir(pasta, { withFileTypes: true }).catch(() => []);
  return (
    await Promise.all(
      lista.map(async (e) =>
        e.isDirectory() ? arquivos(join(pasta, e.name)) : [join(pasta, e.name)],
      ),
    )
  ).flat();
}
async function controlador(
  pasta: string,
  fake: ReturnType<typeof processosFicticios>,
  limite = 120,
) {
  const eventos: DoHost[] = [];
  const auditoria: string[] = [];
  const enviados: string[] = [];
  const detectar = async (_pasta: string, config: ConfiguracaoVoz): Promise<DetectadoVoz> => ({
    ffmpeg: 'ffmpeg',
    whisper: 'whisper-cli',
    modelo: 'modelo-local.bin',
    tts: 'powershell.exe',
    estado: {
      ...estadoInicialVoz(),
      ...config,
      disponivel: true,
      motivo: undefined,
      dispositivo: 'microfone',
      dispositivos: [{ id: 'microfone', nome: 'Simulado' }],
      componentes: (['ffmpeg', 'whisper', 'modelo'] as const).map((c) => ({
        componente: c,
        nome: c,
        situacao: 'instalado',
      })),
      leitura: {
        ...estadoInicialVoz().leitura,
        ...config.leitura,
        motor: config.leitura.motor ?? 'sistema',
        disponivel: true,
        vozes: [{ id: 'voz', nome: 'Voz simulada' }],
      },
    },
  });
  const voz = new VozLocal({
    pasta,
    so: 'win32',
    fabrica: fake.fabrica,
    limiteSegundos: limite,
    detectar,
    agentes: () => agentes,
    emitir: (e) => eventos.push(e),
    enviar: (t) => enviados.push(t),
    auditar: async (r) => {
      auditoria.push(r);
    },
  });
  await voz.inicializar();
  return { voz, eventos, auditoria, enviados };
}
async function http(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const s = createServer(handler);
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const porta = (s.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${porta}`,
    parar: async () => {
      s.closeAllConnections();
      await new Promise<void>((r) => s.close(() => r()));
    },
  };
}
function politicaLocal(url: string): URL {
  const u = new URL(url);
  if (u.protocol !== 'http:' || u.hostname !== '127.0.0.1') throw new Error('Host não permitido.');
  return u;
}
function modeloFixture(url: string, bytes: Buffer): ArtefatoVoz {
  return {
    componente: 'modelo',
    nome: 'Fixture',
    url,
    tamanhoBytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    arquivo: 'ggml-small.bin',
  };
}

test('contrato v3 valida consentimento restrito, configurações e mensagens de voz', () => {
  for (const m of [
    { tipo: 'vozDescartar' },
    { tipo: 'vozCancelarInstalacao' },
    { tipo: 'vozInstalar', componentes: ['modelo'] },
    { tipo: 'vozConfigurar', modelo: 'small', idioma: 'pt', envioAutomatico: false },
    { tipo: 'leituraConfigurar', ativa: true, velocidade: 1 },
    { tipo: 'lerMensagem', id: 'final' },
    { tipo: 'pararLeitura' },
  ])
    assert.deepEqual(validarMensagem(m), m);
  for (const m of [
    { tipo: 'vozInstalar', componentes: [] },
    { tipo: 'vozInstalar', componentes: ['desconhecido'] },
    { tipo: 'vozInstalar', componentes: ['modelo'], url: 'https://evil.test' },
    { tipo: 'vozConfigurar', modelo: 'large' },
    { tipo: 'leituraConfigurar', velocidade: Infinity },
    { tipo: 'leituraConfigurar', velocidade: 0 },
    { tipo: 'leituraConfigurar', velocidade: 3 },
  ])
    assert.throws(() => validarMensagem(m));
});
test('menções faladas usam nicks e aliases com limites de palavras', () => {
  assert.equal(
    normalizarMencoes('Arroba CLAUDE, arroba cx e arroba ag; arroba todos!', agentes),
    '@Claude, @Codex e @Gemini; @todos!',
  );
  assert.equal(
    normalizarMencoes('arroba antigravity e arroba geminiano', agentes),
    '@Gemini e arroba geminiano',
  );
  assert.equal(
    normalizarMencoes('arroba agente especial', [
      { id: 'extra', nick: 'Especial', apelidos: ['agente especial'] },
    ]),
    '@Especial',
  );
});
test('leitura remove markdown, blocos de código e limita conteúdo', () => {
  const limpo = textoParaLeitura(
    '# Título\n**Olá** [mundo](https://example.test)\n```js\nsegredo();\n```\n~~~\noutro();\n~~~\n    codigo_indentado()\n![Imagem](foto.png)',
  );
  assert.equal(
    limpo,
    'Título Olá mundo trecho de codigo omitido trecho de codigo omitido trecho de codigo omitido Imagem',
  );
  assert(!textoParaLeitura('```js\nconteudo sem fechamento').includes('conteudo'));
  assert.equal(textoParaLeitura('x'.repeat(2000)).length, 1500);
});
test('argumentos de gravação/transcrição/leitura por SO e texto fora do argv', () => {
  const wav = 'audio.wav';
  assert(argumentosGravacao('win32', 'Mic "literal"', wav).includes('audio=Mic "literal"'));
  assert(argumentosGravacao('darwin', '2', wav).includes(':2'));
  assert(argumentosGravacao('linux', 'default', wav).includes('pulse'));
  assert(argumentosGravacao('linux', 'alsa:hw:0', wav).includes('hw:0'));
  assert.deepEqual(argumentosGravacao('linux', 'default', wav).slice(-9), [
    '-ac',
    '1',
    '-ar',
    '16000',
    '-c:a',
    'pcm_s16le',
    '-t',
    '120',
    wav,
  ]);
  assert.deepEqual(argumentosTranscricao('modelo.bin', wav, 'auto', 'resultado'), [
    '-m',
    'modelo.bin',
    '-f',
    wav,
    '-l',
    'auto',
    '-otxt',
    '-of',
    'resultado',
    '-nt',
    '-np',
  ]);
  assert(
    argumentosLeitura('win32', 'powershell.exe', 'texto.txt', 'voz', 1).includes('-NonInteractive'),
  );
  assert.deepEqual(argumentosLeitura('darwin', 'say', 'texto.txt', 'Joana', 1.5), [
    '-v',
    'Joana',
    '-r',
    '263',
    '-f',
    'texto.txt',
  ]);
  assert(argumentosLeitura('linux', 'espeak-ng', 'texto.txt', 'pt', 1).includes('--stdin'));
  assert(argumentosMicrofones('win32').includes('dshow'));
  assert(argumentosMicrofones('darwin').includes('avfoundation'));
});
test('microfones e vozes analisados sem confundir dispositivos de vídeo e monitor', () => {
  assert.deepEqual(analisarMicrofones('"Câmera" (video)\n"Microfone" (audio)', 'win32'), [
    { id: 'Microfone', nome: 'Microfone' },
  ]);
  assert.deepEqual(
    analisarMicrofones(
      'AVFoundation video devices:\n[0] Câmera\nAVFoundation audio devices:\n[2] Mic',
      'darwin',
    ),
    [{ id: '2', nome: 'Mic' }],
  );
  assert.deepEqual(
    analisarMicrofones('0 mic module s16le\n1 saida.monitor module s16le', 'linux').map(
      (d) => d.id,
    ),
    ['default', 'mic', 'alsa:default'],
  );
  assert.deepEqual(analisarVozes('[{"id":"voz","nome":"Voz"}]', 'win32'), [
    { id: 'voz', nome: 'Voz' },
  ]);
  assert.deepEqual(analisarVozes('Joana (Premium) pt_PT # Olá', 'darwin'), [
    { id: 'Joana (Premium)', nome: 'Joana (Premium)' },
  ]);
});
test('detecção prioriza pasta própria e monta estado/manual sem baixar', async () => {
  const tmp = await temporario();
  try {
    await mkdir(join(tmp.pasta, 'bin'));
    await writeFile(join(tmp.pasta, 'bin', 'ffmpeg.exe'), 'fixture');
    await writeFile(join(tmp.pasta, 'bin', 'whisper-cli.exe'), 'fixture');
    const comandos: string[] = [];
    const fabrica: FabricaProcesso = (cmd, args) => {
      comandos.push(cmd);
      const p = processoManual();
      queueMicrotask(() =>
        p.resolver({
          saida: cmd === 'powershell.exe' ? '[{"id":"voz","nome":"Voz"}]' : '',
          erro: args.includes('-list_devices') ? '"Mic" (audio)' : '',
        }),
      );
      return p;
    };
    const r = await detectarVoz(tmp.pasta, padraoVoz(), 'win32', fabrica);
    assert.equal(r.ffmpeg, join(tmp.pasta, 'bin', 'ffmpeg.exe'));
    assert.equal(r.whisper, join(tmp.pasta, 'bin', 'whisper-cli.exe'));
    assert(!comandos.includes('ffmpeg'));
    assert.equal(r.estado.modelo, 'small');
    assert.equal(r.estado.idioma, 'pt');
    assert.equal(r.estado.disponivel, false);
    assert.equal(r.estado.leitura.disponivel, true);
    assert.equal(r.estado.componentes[2].tamanhoBytes, 487601967);
    const ausente: FabricaProcesso = () => {
      const p = processoManual();
      queueMicrotask(() => p.resolver({ codigo: 1 }));
      return p;
    };
    for (const so of ['linux', 'darwin'] as const) {
      const manual = await detectarVoz(tmp.pasta, padraoVoz(), so, ausente);
      assert.equal(manual.estado.componentes[0].situacao, 'manual');
      assert(manual.estado.componentes[0].comandoManual);
    }
  } finally {
    await tmp.limpar();
  }
});

for (const caso of [
  'sucesso',
  'erro',
  'descarte',
  'cancelamento',
  'deactivate',
  'automático',
  'limite',
] as const)
  test(`gravação e transcrição fictícias: ${caso}, sem WAV residual ou texto em auditoria`, async () => {
    const tmp = await temporario();
    const fake = processosFicticios({ falhar: caso === 'erro', pendente: caso === 'cancelamento' });
    const c = await controlador(tmp.pasta, fake, caso === 'limite' ? 1 : 120);
    try {
      if (caso === 'automático') await c.voz.configurar({ envioAutomatico: true });
      await c.voz.iniciar();
      assert.equal(c.voz.estado.gravando, true);
      if (caso === 'descarte') await c.voz.descartar();
      else if (caso === 'deactivate') await c.voz.finalizar();
      else if (caso === 'cancelamento') {
        const tarefa = c.voz.parar();
        await esperar(() => fake.chamados.some((p) => p.comando === 'whisper-cli'));
        await c.voz.descartar();
        await tarefa;
        assert(fake.chamados.find((p) => p.comando === 'whisper-cli')?.p.cancelado);
      } else if (caso === 'limite')
        await esperar(() => c.eventos.some((e) => e.tipo === 'voz' && !!e.transcricao));
      else await c.voz.parar();
      await c.voz.finalizar();
      assert.equal(c.voz.estado.gravando, false);
      assert.equal(c.voz.estado.transcrevendo, false);
      assert(!(await arquivos(tmp.pasta)).some((p) => /\.(wav|txt)$/i.test(p)));
      const transcricoes = c.eventos.filter((e) => e.tipo === 'voz' && e.transcricao);
      if (caso === 'sucesso' || caso === 'limite')
        assert.deepEqual(
          transcricoes.map((e) => (e.tipo === 'voz' ? e.transcricao : '')),
          ['@Claude veja @Gemini'],
        );
      if (caso === 'automático') {
        assert.deepEqual(c.enviados, ['@Claude veja @Gemini']);
        assert.equal(transcricoes.length, 0);
      }
      if (caso === 'descarte' || caso === 'deactivate')
        assert(!fake.chamados.some((p) => p.comando === 'whisper-cli'));
      assert(!JSON.stringify(c.eventos).includes('DADO PRIVADO'));
      assert(c.auditoria.every((a) => /^voz transcricao \d+s$/.test(a)));
      assert(!JSON.stringify(c.auditoria).includes('Claude'));
      assert(fake.chamados.find((p) => p.comando === 'ffmpeg')!.p.entrada.includes('q'));
    } finally {
      await c.voz.finalizar();
      await tmp.limpar();
    }
  });
test('configuração de voz persiste separada da conversa, com defaults seguros', async () => {
  const tmp = await temporario();
  const c = await controlador(tmp.pasta, processosFicticios());
  try {
    await c.voz.configurar({ modelo: 'medium', idioma: 'es', envioAutomatico: true });
    await c.voz.configurarLeitura({ ativa: true, voz: 'voz', velocidade: 1.5 });
    await c.voz.finalizar();
    const persistida = await carregarConfiguracao(join(tmp.pasta, 'configuracao.json'));
    assert.deepEqual(persistida, {
      modelo: 'medium',
      idioma: 'es',
      envioAutomatico: true,
      leitura: { ativa: true, voz: 'voz', velocidade: 1.5, variacao: 0.5, vozesNuvem: [] },
    });
    const segunda = await controlador(tmp.pasta, processosFicticios());
    assert.equal(segunda.voz.estado.modelo, 'medium');
    assert.equal(segunda.voz.estado.leitura.ativa, true);
    await segunda.voz.finalizar();
    assert.equal(padraoVoz().leitura.ativa, false);
    assert.equal(padraoVoz().envioAutomatico, false);
  } finally {
    await c.voz.finalizar();
    await tmp.limpar();
  }
});
test('leitura automática só de agentes finais, sem duplicar parciais ou falar durante captura', async () => {
  const tmp = await temporario();
  const fake = processosFicticios({ ttsPendente: true });
  const c = await controlador(tmp.pasta, fake);
  try {
    await c.voz.configurarLeitura({ ativa: true });
    c.voz.mensagem({ ...fala('1'), parcial: true });
    c.voz.mensagem({ ...fala('2'), autor: 'Usuário' });
    c.voz.mensagem({ ...fala('3'), tipo: 'acao' });
    await pausa();
    assert.equal(fake.chamados.length, 0);
    c.voz.mensagem(fala('1'));
    c.voz.mensagem(fala('1'));
    await esperar(() => fake.chamados.length === 1);
    assert.equal(c.voz.estado.leitura.falando, '1');
    assert(fake.chamados[0].p.entrada.includes('Resposta final'));
    assert(!fake.chamados[0].args.join(' ').includes('Resposta'));
    c.voz.mensagem(fala('4'));
    await c.voz.iniciar();
    assert(fake.chamados[0].p.cancelado);
    assert.equal(c.voz.estado.leitura.falando, undefined);
    c.voz.mensagem(fala('5'));
    await pausa();
    assert.equal(fake.chamados.filter((p) => p.comando === 'powershell.exe').length, 1);
    await c.voz.descartar();
    await c.voz.finalizar();
    assert.deepEqual(await arquivos(join(tmp.pasta, 'temporarios')), []);
  } finally {
    await c.voz.finalizar();
    await tmp.limpar();
  }
});
test('pararLeitura cancela inclusive a inicialização e remove arquivo temporário do macOS', async () => {
  const tmp = await temporario();
  const fake = processosFicticios({ ttsPendente: true });
  const leitor = new Leitor(tmp.pasta, fake.fabrica, 'darwin');
  try {
    const primeira = leitor.ler('say', 'Texto sensível', estadoInicialVoz().leitura);
    await leitor.parar();
    await primeira;
    const segunda = leitor.ler('say', 'Texto sensível', estadoInicialVoz().leitura);
    await esperar(() => fake.chamados.length > 0);
    const arquivo = fake.chamados.at(-1)!.args.at(-1)!;
    assert.equal(await readFile(arquivo, 'utf8'), 'Texto sensível');
    assert(!fake.chamados.at(-1)!.args.includes('Texto sensível'));
    await leitor.parar();
    await segunda;
    assert.deepEqual(await arquivos(tmp.pasta), []);
  } finally {
    await leitor.parar();
    await tmp.limpar();
  }
});
test('processos de voz respeitam timeout e aborto sem propagar stderr', async () => {
  const p = processoManual();
  const fabrica: FabricaProcesso = () => p;
  await assert.rejects(executarVoz('fake', [], { fabrica, timeoutMs: 10 }), /tempo limite/);
  assert(p.cancelado);
  const controle = new AbortController();
  const p2 = processoManual();
  const tarefa = executarVoz('fake', [], { fabrica: () => p2, sinal: controle.signal });
  controle.abort();
  await assert.rejects(tarefa, /cancelada/);
  assert(p2.cancelado);
});

test('downloads de produção aceitam somente HTTPS e hosts exatos conhecidos', () => {
  for (const url of [
    'https://github.com/a',
    'https://release-assets.githubusercontent.com/a',
    'https://us.aws.cdn.hf.co/a',
    'https://huggingface.co/a',
  ])
    assert(validarDownload(url));
  for (const url of [
    'http://github.com/a',
    'https://github.com.evil.test/a',
    'https://evil.test/a',
    'https://usuario:senha@github.com/a',
    'https://github.com:8443/a',
    'file:///modelo.bin',
  ])
    assert.throws(() => validarDownload(url));
});
for (const caso of [
  'hash correto',
  'hash errado',
  'redirecionamento proibido',
  'retomada',
] as const)
  test(`instalador HTTP local: ${caso}`, async () => {
    const tmp = await temporario();
    const bytes = Buffer.from('modelo de teste sem binário real');
    const eventos: ProgressoInstalacaoVoz[] = [];
    const pedidos: string[] = [];
    const servidor = await http((req, res) => {
      pedidos.push(req.url ?? '');
      if (caso === 'redirecionamento proibido') {
        res.writeHead(302, { Location: 'https://evil.test/modelo' });
        res.end();
        return;
      }
      if (caso === 'retomada') {
        const inicio = Number(req.headers.range?.match(/bytes=(\d+)-/)?.[1]);
        assert.equal(inicio, 5);
        res.writeHead(206, {
          'Content-Range': `bytes ${inicio}-${bytes.length - 1}/${bytes.length}`,
        });
        res.end(bytes.subarray(inicio));
      } else res.end(bytes);
    });
    try {
      const item = modeloFixture(servidor.url + '/modelo', bytes);
      if (caso === 'hash errado') item.sha256 = '0'.repeat(64);
      if (caso === 'retomada') {
        await mkdir(join(tmp.pasta, 'downloads'));
        await writeFile(
          join(tmp.pasta, 'downloads', item.arquivo + '.parcial'),
          bytes.subarray(0, 5),
        );
      }
      await new InstaladorVoz(tmp.pasta, (p) => eventos.push(p), politicaLocal).instalar([item]);
      assert.deepEqual(pedidos, ['/modelo']);
      if (caso === 'hash correto' || caso === 'retomada') {
        assert.equal(eventos.at(-1)?.etapa, 'concluido');
        assert.deepEqual(await readFile(join(tmp.pasta, 'modelos', item.arquivo)), bytes);
      } else {
        assert.equal(eventos.at(-1)?.etapa, 'erro');
        assert(!(await arquivos(tmp.pasta)).some((p) => p.includes('modelos')));
        if (caso === 'hash errado') {
          assert(eventos.at(-1)?.mensagem?.includes('SHA-256'));
          assert(!(await arquivos(tmp.pasta)).some((p) => p.endsWith('.parcial')));
        }
      }
    } finally {
      await servidor.parar();
      await tmp.limpar();
    }
  });
test('instalador cancela download, limita progresso e não inicia componente seguinte', async () => {
  const tmp = await temporario();
  const eventos: ProgressoInstalacaoVoz[] = [];
  let pedidos = 0;
  const servidor = await http((_req, res) => {
    pedidos++;
    res.write(Buffer.alloc(100));
    const timer = setInterval(() => res.write(Buffer.alloc(100)), 20);
    res.on('close', () => clearInterval(timer));
  });
  const instalador = new InstaladorVoz(tmp.pasta, (p) => eventos.push(p), politicaLocal);
  try {
    const item = modeloFixture(servidor.url, Buffer.alloc(100000));
    const tarefa = instalador.instalar([item, { ...item, arquivo: 'ggml-base.bin' }]);
    await esperar(() => eventos.some((p) => !!p.baixadoBytes));
    await pausa(300);
    instalador.cancelar();
    await tarefa;
    assert.equal(eventos.at(-1)?.etapa, 'cancelado');
    assert.equal(pedidos, 1);
    assert(eventos.filter((p) => p.etapa === 'baixando').length <= 3);
    assert(!(await arquivos(tmp.pasta)).some((p) => p.includes('modelos')));
  } finally {
    await instalador.finalizar();
    await servidor.parar();
    await tmp.limpar();
  }
});
test('ZIP de voz extrai somente executável e DLLs necessárias e rejeita traversal/symlink', async () => {
  const tmp = await temporario();
  try {
    const zip = new JSZip();
    zip.file('Release/whisper-cli.exe', 'executável fixture');
    zip.file('Release/whisper.dll', 'DLL fixture');
    zip.file('Release/ggml.dll', 'DLL fixture');
    zip.file('Release/ggml-cpu-x64.dll', 'DLL fixture');
    zip.file('Release/whisper-server.exe', 'proibido');
    zip.file('Release/SDL2.dll', 'desnecessário');
    const arquivo = join(tmp.pasta, 'fixture.zip');
    await writeFile(arquivo, await zip.generateAsync({ type: 'nodebuffer' }));
    const destino = join(tmp.pasta, 'bin');
    await extrairBinarios(arquivo, destino, 'whisper');
    assert.deepEqual((await readdir(destino)).sort(), [
      'ggml-cpu-x64.dll',
      'ggml.dll',
      'whisper-cli.exe',
      'whisper.dll',
    ]);
    for (const caminho of [
      '../escape.exe',
      'Release/../../escape.dll',
      'C:/escape.exe',
      '/escape.exe',
    ]) {
      const ruim = new JSZip();
      ruim.file('Release/whisper-cli.exe', 'fixture');
      ruim.file(caminho, 'fixture');
      await writeFile(arquivo, await ruim.generateAsync({ type: 'nodebuffer' }));
      await assert.rejects(
        extrairBinarios(arquivo, join(tmp.pasta, 'recusado'), 'whisper'),
        /inseguro/,
      );
    }
    const link = new JSZip();
    link.file('Release/whisper-cli.exe', 'fixture', { unixPermissions: 0o120777 });
    await writeFile(arquivo, await link.generateAsync({ type: 'nodebuffer', platform: 'UNIX' }));
    await assert.rejects(extrairBinarios(arquivo, join(tmp.pasta, 'link'), 'whisper'), /inseguro/);
    assert(!(await arquivos(tmp.pasta)).some((p) => basename(p) === 'escape.exe'));
  } finally {
    await tmp.limpar();
  }
});
test('instalador confere SHA antes de extrair ZIP e publica executável limitado', async () => {
  const tmp = await temporario();
  const zip = new JSZip();
  zip.file('ffmpeg-9.0.2/bin/ffmpeg.exe', 'fixture');
  zip.file('ffmpeg-9.0.2/bin/ffprobe.exe', 'não extrair');
  const bytes = await zip.generateAsync({ type: 'nodebuffer' });
  const servidor = await http((_req, res) => res.end(bytes));
  const eventos: ProgressoInstalacaoVoz[] = [];
  try {
    const item = {
      ...modeloFixture(servidor.url, bytes),
      componente: 'ffmpeg' as const,
      arquivo: 'ffmpeg.zip',
      zip: true,
    };
    await new InstaladorVoz(tmp.pasta, (p) => eventos.push(p), politicaLocal).instalar([item]);
    assert.deepEqual(await readdir(join(tmp.pasta, 'bin')), ['ffmpeg.exe']);
    assert(
      eventos.findIndex((p) => p.etapa === 'verificando') <
        eventos.findIndex((p) => p.etapa === 'extraindo'),
    );
    assert(!(await arquivos(tmp.pasta)).some((p) => p.endsWith('.parcial')));
    const ruim = { ...item, sha256: '0'.repeat(64), arquivo: 'ruim.zip' };
    const erros: ProgressoInstalacaoVoz[] = [];
    await new InstaladorVoz(join(tmp.pasta, 'outro'), (p) => erros.push(p), politicaLocal).instalar(
      [ruim],
    );
    assert(!erros.some((p) => p.etapa === 'extraindo'));
  } finally {
    await servidor.parar();
    await tmp.limpar();
  }
});
test('catálogo fixa versões, tamanhos e todos os hashes de artefatos', () => {
  for (const c of ['ffmpeg', 'whisper', 'modelo'] as const)
    for (const m of ['base', 'small', 'medium'] as const) {
      const item = artefato(c, m);
      assert.match(item.sha256, /^[a-f0-9]{64}$/);
      assert(item.tamanhoBytes > 0);
      assert(!item.url.includes('/latest/'));
      assert(!item.url.includes('/main/'));
      validarDownload(item.url);
    }
});
test('consentimento do host instala só componentes selecionados e audita apenas resultados', async () => {
  const tmp = await temporario();
  const pedidos: ArtefatoVoz[][] = [];
  const auditoria: string[] = [];
  const eventos: DoHost[] = [];
  let cancelar!: () => void;
  let detectados = 0;
  const voz = new VozLocal({
    pasta: tmp.pasta,
    so: 'win32',
    agentes: () => agentes,
    enviar: () => {},
    emitir: (e) => eventos.push(e),
    auditar: async (r) => {
      auditoria.push(r);
    },
    detectar: async () => {
      detectados++;
      return {
        modelo: 'modelo',
        estado: {
          ...estadoInicialVoz(),
          componentes: (['ffmpeg', 'whisper', 'modelo'] as const).map((c) => ({
            componente: c,
            nome: c,
            situacao: 'ausente',
          })),
        },
      };
    },
    instalador: (_pasta, emitir) => {
      let concluir: (() => void) | undefined;
      cancelar = () => {
        if (concluir) {
          emitir({ componente: 'modelo', etapa: 'cancelado' });
          concluir();
          concluir = undefined;
        }
      };
      return {
        instalar: async (itens) => {
          pedidos.push(itens);
          await new Promise<void>((r) => {
            concluir = r;
            emitir({ componente: 'modelo', etapa: 'baixando' });
          });
        },
        cancelar,
        finalizar: async () => cancelar(),
      };
    },
  });
  try {
    await voz.inicializar();
    assert.equal(pedidos.length, 0);
    const tarefa = voz.instalar(['modelo', 'modelo']);
    assert.equal(pedidos.length, 1);
    assert.equal(pedidos[0].length, 1);
    assert.equal(pedidos[0][0].arquivo, 'ggml-small.bin');
    assert.throws(() => voz.instalar(['ffmpeg']), /andamento/);
    await voz.finalizar();
    await tarefa;
    assert.deepEqual(auditoria, ['voz instalacao modelo cancelado']);
    assert.equal(detectados, 1, 'não inicia detecção de componentes após deactivate');
    assert(eventos.some((e) => e.tipo === 'vozInstalacao' && e.progresso.etapa === 'cancelado'));
  } finally {
    await voz.finalizar();
    await tmp.limpar();
  }
});
test('ZIP com traversal recebido por HTTP é recusado após o hash, antes de publicar', async () => {
  const tmp = await temporario();
  const zip = new JSZip();
  zip.file('ffmpeg/bin/ffmpeg.exe', 'fixture');
  zip.file('../escape.exe', 'fixture');
  const bytes = await zip.generateAsync({ type: 'nodebuffer' });
  const servidor = await http((_req, res) => res.end(bytes));
  const eventos: ProgressoInstalacaoVoz[] = [];
  try {
    await new InstaladorVoz(tmp.pasta, (p) => eventos.push(p), politicaLocal).instalar([
      {
        ...modeloFixture(servidor.url, bytes),
        componente: 'ffmpeg',
        arquivo: 'traversal.zip',
        zip: true,
      },
    ]);
    assert.equal(eventos.at(-1)?.etapa, 'erro');
    assert(eventos.at(-1)?.mensagem?.includes('inseguro'));
    assert(!(await arquivos(tmp.pasta)).some((p) => p.endsWith('.exe')));
    assert(!(await readdir(join(tmp.pasta, 'downloads'))).some((p) => p.startsWith('extracao-')));
  } finally {
    await servidor.parar();
    await tmp.limpar();
  }
});
test('adaptador real executa um processo Node fictício com stdin Unicode e sem shell', async () => {
  const tmp = await temporario();
  try {
    const script = join(tmp.pasta, 'processo-falso.cjs');
    await writeFile(
      script,
      "let entrada='';process.stdin.setEncoding('utf8');process.stdin.on('data',d=>entrada+=d);process.stdin.on('end',()=>{process.stdout.write(JSON.stringify({entrada,args:process.argv.slice(2)}));});",
    );
    const texto = 'Olá; $(não executar) & texto sensível';
    const r = await executarVoz(process.execPath, [script, 'literal;sem-shell'], {
      entrada: texto,
      timeoutMs: 3000,
    });
    assert.equal(r.codigo, 0);
    assert.deepEqual(JSON.parse(r.saida), { entrada: texto, args: ['literal;sem-shell'] });
  } finally {
    await tmp.limpar();
  }
});
