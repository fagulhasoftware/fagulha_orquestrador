import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { VozNuvem, segredoTts } from '../src/voice/nuvem';
import { wavPcm, validarAudio } from '../src/voice/tts';
import { PonteAudio } from '../src/voice/ponte-audio';
import { VozLocal } from '../src/voice/controlador';
import { padraoVoz, estadoInicialVoz } from '../src/voice/configuracao';
import { agentePadrao } from '../src/providers/tipos';
import { validarMensagem } from '../src/core/protocolo';
import { montarHtml } from '../src/core/webview';
import { temporario } from './apoio';
import type { PacoteAudioVoz, DoHost } from '../src/shared/protocolo';

test('provedores HTTP reais simulados: catalogos, payloads oficiais e chaves somente no cofre', async () => {
  const wav = wavPcm(Buffer.alloc(480)),
    chamadas: { url: string; headers: any; body: any }[] = [],
    cofre = new Map<string, string>();
  const chave = 'fixture-neural-credential-unica';
  const servidor = createServer(async (req, res) => {
    let b = '';
    for await (const p of req) b += p;
    const body = b ? JSON.parse(b) : undefined;
    chamadas.push({ url: req.url!, headers: req.headers, body });
    res.setHeader('content-type', 'application/json');
    if (req.url === '/v1/models') {
      res.end(
        JSON.stringify(
          req.headers['xi-api-key']
            ? [
                { model_id: 'fixture-eleven', name: 'Fixture Eleven', can_do_text_to_speech: true },
                { model_id: 'fixture-nao-tts', can_do_text_to_speech: false },
              ]
            : { data: [{ id: 'gpt-4o-mini-tts' }] },
        ),
      );
      return;
    }
    if (req.url?.startsWith('/v2/voices')) {
      res.end(
        JSON.stringify({
          voices: [{ voice_id: 'fixture-voz', name: 'Voz de teste' }],
          has_more: false,
        }),
      );
      return;
    }
    if (req.url === '/v1beta/models') {
      res.end(
        JSON.stringify({
          models: [{ name: 'models/gemini-3.8-flash-tts', displayName: 'Gemini TTS' }],
        }),
      );
      return;
    }
    if (req.url?.startsWith('/v1beta/voices')) {
      res.end(
        JSON.stringify({
          voices: [{ id: 'fixture-google-voz', display_name: 'Voz Google teste' }],
        }),
      );
      return;
    }
    if (req.url === '/v1/audio/speech') {
      res.setHeader('content-type', 'audio/wav');
      res.end(wav);
      return;
    }
    if (req.url?.startsWith('/v1/text-to-speech/')) {
      res.setHeader('content-type', 'audio/mpeg');
      res.end(Buffer.concat([Buffer.from('ID3'), Buffer.alloc(20)]));
      return;
    }
    if (req.url === '/v1beta/interactions') {
      res.end(
        JSON.stringify({
          steps: [
            {
              type: 'model_output',
              content: [{ type: 'audio', mime_type: 'audio/wav', data: wav.toString('base64') }],
            },
          ],
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
  try {
    const n = new VozNuvem(
      {
        get: async (k) => cofre.get(k),
        store: async (k, v) => {
          cofre.set(k, v);
        },
        delete: async (k) => {
          cofre.delete(k);
        },
      },
      `http://127.0.0.1:${(servidor.address() as any).port}`,
    );
    for (const p of ['openai', 'elevenlabs', 'gemini'] as const) {
      await n.salvar(p, chave);
      const c = await n.catalogo(p);
      assert.equal(c.modelos.length, 1);
      const a = await n.audio(
        p,
        'Frase de teste',
        { modelo: c.modelos[0].id, voz: p === 'openai' ? 'coral' : c.vozes[0].id },
        new AbortController().signal,
      );
      assert(a.dados.length > 12);
      assert.equal(await n.mascara(p), '••••nica');
      assert(!JSON.stringify(c).includes(chave));
      assert.equal(cofre.get(segredoTts(p)), chave);
    }
    const corpo = chamadas.filter((c) => c.body);
    assert(corpo.every((c) => !JSON.stringify(c.body).includes(chave)));
    assert.equal(corpo.find((c) => c.url === '/v1/audio/speech')!.body.model, 'gpt-4o-mini-tts');
    const google = corpo.find((c) => c.url === '/v1beta/interactions')!;
    assert.equal(google.body.generation_config.speech_config[0].voice, 'fixture-google-voz');
    assert.equal(google.body.store, false);
    assert(chamadas.filter((c) => c.url.startsWith('/v2/voices')).length);
    await n.remover('elevenlabs');
    assert(!cofre.has(segredoTts('elevenlabs')));
    assert(cofre.has(segredoTts('gemini')));
  } finally {
    await new Promise<void>((r) => servidor.close(() => r()));
  }
});

test('OpenAI Realtime recebe PCM e monta WAV sem player ou arquivo externo', async () => {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise<void>((r) => wss.once('listening', r));
  const recebidos: any[] = [];
  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      const j = JSON.parse(raw.toString());
      recebidos.push(j);
      if (j.type === 'session.update') ws.send(JSON.stringify({ type: 'session.updated' }));
      if (j.type === 'response.create') {
        ws.send(
          JSON.stringify({
            type: 'response.output_audio.delta',
            delta: Buffer.alloc(480).toString('base64'),
          }),
        );
        ws.send(JSON.stringify({ type: 'response.done', response: { status: 'completed' } }));
      }
    });
  });
  const http = createServer((_req, res) =>
    res.end(JSON.stringify({ data: [{ id: 'gpt-realtime-2.1-mini' }] })),
  );
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  try {
    const n = new VozNuvem(
      { get: async () => 'fixture-realtime-credential', store: async () => {} },
      `http://127.0.0.1:${(http.address() as any).port}`,
      15000,
      `ws://127.0.0.1:${(wss.address() as any).port}`,
    );
    const a = await n.audio(
      'openai',
      'Leia literalmente esta frase.',
      { modelo: 'gpt-realtime-2.1-mini', voz: 'marin' },
      new AbortController().signal,
    );
    assert.equal(a.dados.length, 524);
    assert.equal(a.dados.toString('ascii', 0, 4), 'RIFF');
    assert.equal(recebidos[0].session.audio.output.voice, 'marin');
    assert(!JSON.stringify(recebidos).includes('fixture-realtime-credential'));
  } finally {
    for (const c of wss.clients) c.terminate();
    await new Promise<void>((r) => wss.close(() => r()));
    await new Promise<void>((r) => http.close(() => r()));
  }
});

test('audio malformado e parametros desconhecidos nao sao aceitos', () => {
  assert.throws(() => validarAudio({ dados: Buffer.alloc(100), mime: 'audio/wav' }), /WAV/);
  assert.equal(
    validarMensagem({ tipo: 'leituraNuvemChave', provedor: 'gemini', chave: 'fixture' }).tipo,
    'leituraNuvemChave',
  );
  assert.throws(() =>
    validarMensagem({ tipo: 'leituraNuvemChave', provedor: 'anthropic', chave: 'fixture' }),
  );
  assert(montarHtml('fixture', 'css', 'js').includes('media-src fixture blob: data:'));
  assert(!montarHtml('fixture', 'css', 'js').includes('media-src *'));
});

test('ponte de audio correlaciona ACK por painel e cancela reproducao antiga', async () => {
  const enviados: DoHost[] = [],
    tela = {
      postMessage: async (m: DoHost) => {
        enviados.push(m);
        return true;
      },
    },
    outra = { postMessage: async () => true };
  const p = new PonteAudio(() => tela, 2000),
    controle = new AbortController();
  let concluida = false;
  const tarefa = p.reproduzir({ texto: 'teste', velocidade: 1 }, controle.signal).then(() => {
    concluida = true;
  });
  const evento = enviados[0];
  assert.equal(evento.tipo, 'vozReproduzir');
  if (evento.tipo !== 'vozReproduzir') return;
  p.responder(outra, evento.audio.id, 'concluido');
  await Promise.resolve();
  assert(!concluida);
  p.responder(tela, evento.audio.id, 'concluido');
  await tarefa;
  const pendente = p.reproduzir({ texto: 'segunda', velocidade: 1 }, controle.signal);
  controle.abort();
  await assert.rejects(pendente, /cancelada/);
  assert(enviados.some((e) => e.tipo === 'vozPararAudio'));
});

test('falha de permissao/cota usa voz webview, avisa uma vez e preserva voz por agente', async () => {
  const tmp = await temporario();
  try {
    const config = padraoVoz();
    config.leitura = {
      ...config.leitura,
      motor: 'nuvem',
      provedor: 'elevenlabs',
      vozesNuvem: [
        { id: 'voz-a', nome: 'A' },
        { id: 'voz-b', nome: 'B' },
      ],
      voz: 'voz-a',
      porAgente: { codex: 'voz-b' },
    };
    let tentativas = 0;
    const pacotes: Omit<PacoteAudioVoz, 'id'>[] = [],
      eventos: DoHost[] = [];
    const nuvem = {
      configurada: async () => true,
      mascara: async () => '••••1234',
      audio: async (_p: any, _t: any, o: any) => {
        tentativas++;
        assert.equal(o.voz, 'voz-b');
        throw Error('HTTP 401 missing_permissions');
      },
    } as unknown as VozNuvem;
    const v = new VozLocal({
      pasta: tmp.pasta,
      nuvem,
      carregar: async () => config,
      emitir: (e) => eventos.push(e),
      agentes: () => [agentePadrao('codex', 'Codex', 'cli', 'azul')],
      enviar: () => {},
      auditar: async () => {},
      detectar: async () => ({ estado: estadoInicialVoz(), modelo: 'fixture' }),
      reproduzir: async (p) => {
        pacotes.push(p);
      },
    });
    await v.inicializar();
    const m = {
      id: 'a',
      sala: 's',
      quando: new Date().toISOString(),
      autor: 'Codex',
      tipo: 'fala' as const,
      texto: 'Teste',
    };
    await v.ler(m);
    await v.ler({ ...m, id: 'b' });
    assert.equal(pacotes.length, 2);
    assert(pacotes.every((p) => !p.base64));
    assert.equal(tentativas, 1);
    assert.equal(eventos.filter((e) => e.tipo === 'aviso').length, 1);
    assert.equal(v.estado.leitura.falando, undefined);
    assert(!JSON.stringify(config).includes('fixture-neural-credential'));
    await v.finalizar();
  } finally {
    await tmp.limpar();
  }
});
