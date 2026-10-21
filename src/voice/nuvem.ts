import type { Segredos } from '../providers/tipos';
import { mascarar, protegerSegredo } from '../core/seguranca';
import { sintetizarRealtime } from './realtime';
import {
  VOZES_GEMINI,
  VOZES_REALTIME,
  VOZES_SPEECH,
  lerAudioLimitado,
  validarAudio,
  wavPcm,
  type ProvedorTts,
  type CatalogoTts,
  type AudioTts,
  type PedidoTts,
  type ProvedorSintese,
} from './tts';
export type { ProvedorTts } from './tts';
export { wavPcm } from './tts';
export const segredoTts = (p: ProvedorTts) => `fagulha.voz.${p}`;
export class VozNuvem {
  private catalogos = new Map<ProvedorTts, CatalogoTts>();
  private provedores: Record<ProvedorTts, ProvedorSintese>;
  constructor(
    private segredos: Segredos,
    private endpointTeste?: string,
    private timeoutMs = 15000,
    private realtimeUrlTeste?: string,
  ) {
    this.provedores = {
      openai: {
        catalogo: (k) => this.listar('openai', k),
        sintetizar: (k, p) =>
          p.modelo.startsWith('gpt-realtime-')
            ? sintetizarRealtime(k, p, this.realtimeUrlTeste)
            : this.http('openai', k, p),
      },
      gemini: {
        catalogo: (k) => this.listar('gemini', k),
        sintetizar: (k, p) => this.http('gemini', k, p),
      },
      elevenlabs: {
        catalogo: (k) => this.listar('elevenlabs', k),
        sintetizar: (k, p) => this.http('elevenlabs', k, p),
      },
    };
  }
  private base(p: ProvedorTts) {
    return (
      this.endpointTeste ??
      {
        openai: 'https://api.openai.com',
        gemini: 'https://generativelanguage.googleapis.com',
        elevenlabs: 'https://api.elevenlabs.io',
      }[p]
    );
  }
  private headers(p: ProvedorTts, k: string): Record<string, string> {
    return p === 'openai'
      ? { authorization: `Bearer ${k}` }
      : { [p === 'gemini' ? 'x-goog-api-key' : 'xi-api-key']: k };
  }
  private async json(p: ProvedorTts, k: string, caminho: string) {
    const r = await fetch(this.base(p) + caminho, {
      headers: this.headers(p, k),
      redirect: 'error',
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!r.ok) {
      await r.body?.cancel();
      throw Error(`Catalogo de voz recusado (HTTP ${r.status}). Verifique chave e permissoes.`);
    }
    return JSON.parse((await lerAudioLimitado(r, 2 * 1024 * 1024)).toString('utf8'));
  }
  private async listar(p: ProvedorTts, k: string): Promise<CatalogoTts> {
    if (p === 'openai') {
      const j = await this.json(p, k, '/v1/models');
      const ids = new Set((j.data ?? []).map((m: any) => m.id));
      const modelos = ['gpt-realtime-2.1-mini', 'gpt-4o-mini-tts', 'tts-1', 'tts-1-hd']
        .filter((id) => ids.has(id))
        .map((id) => ({
          id,
          nome: id,
          vozes: id.startsWith('gpt-realtime')
            ? VOZES_REALTIME
            : id === 'gpt-4o-mini-tts'
              ? VOZES_SPEECH
              : ['alloy', 'ash', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer'],
        }));
      return {
        modelos,
        vozes: VOZES_SPEECH.map((id) => ({ id, nome: id })),
        nota: 'Vozes oficiais predefinidas. Speech API antiga encerra em 06/01/2027; prefira Realtime. Assinatura ChatGPT nao fornece chave da API.',
      };
    }
    if (p === 'elevenlabs') {
      const modelos = (await this.json(p, k, '/v1/models'))
        .filter((m: any) => m.can_do_text_to_speech === true)
        .map((m: any) => ({ id: m.model_id, nome: m.name ?? m.model_id }));
      const vozes: { id: string; nome: string }[] = [];
      let token = '';
      for (let i = 0; i < 10; i++) {
        const j = await this.json(
          p,
          k,
          '/v2/voices?page_size=100' +
            (token ? '&next_page_token=' + encodeURIComponent(token) : ''),
        );
        for (const v of j.voices ?? [])
          if (typeof v.voice_id === 'string')
            vozes.push({ id: v.voice_id, nome: mascarar(String(v.name ?? v.voice_id)) });
        token = j.next_page_token;
        if (!j.has_more || !token) break;
      }
      return { modelos, vozes };
    }
    const j = await this.json(p, k, '/v1beta/models');
    const permitidos = new Set(['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts']);
    const modelos = (j.models ?? [])
      .map((m: any) => ({
        id: String(m.name).replace(/^models\//, ''),
        nome: m.displayName ?? m.name,
      }))
      .filter((m: any) => permitidos.has(m.id));
    let vozes = VOZES_GEMINI.map((id) => ({ id, nome: id }));
    let nota = 'Vozes predefinidas oficiais Gemini.';
    try {
      let token = '';
      const lista: typeof vozes = [];
      for (let pagina = 0; pagina < 10; pagina++) {
        const v = await this.json(
          p,
          k,
          '/v1beta/voices?page_size=100' +
            (token ? '&page_token=' + encodeURIComponent(token) : ''),
        );
        for (const x of v.voices ?? [])
          if (typeof x.id === 'string')
            lista.push({ id: x.id, nome: mascarar(String(x.display_name ?? x.id)) });
        token = v.next_page_token;
        if (!token) break;
      }
      if (lista.length) {
        vozes = lista;
        nota = 'Catalogo de vozes retornado pela API Gemini.';
      }
    } catch {
      nota += ' A biblioteca estendida nao respondeu; usando catalogo documentado.';
    }
    return { modelos, vozes, nota };
  }
  async catalogo(p: ProvedorTts, atualizar = false): Promise<CatalogoTts> {
    if (!atualizar && this.catalogos.has(p)) return this.catalogos.get(p)!;
    const k = await this.segredos.get(segredoTts(p));
    if (!k) throw Error('Configure a chave deste provedor de voz.');
    protegerSegredo(k);
    const c = await this.provedores[p].catalogo(k);
    this.catalogos.set(p, c);
    return c;
  }
  async validar(p: ProvedorTts, k: string) {
    protegerSegredo(k);
    if (k.trim().length < 10 || k.length > 4096 || /[\r\n]/.test(k))
      throw Error('Formato da chave de voz invalido.');
    const c = await this.provedores[p].catalogo(k);
    if (!c.vozes.length || !c.modelos.length)
      throw Error('Nenhum modelo ou voz TTS disponivel para esta chave.');
    return c;
  }
  async salvar(p: ProvedorTts, k: string) {
    const c = await this.validar(p, k);
    await this.segredos.store(segredoTts(p), k);
    this.catalogos.set(p, c);
    return c.vozes;
  }
  async configurada(p?: ProvedorTts) {
    return !!p && !!(await this.segredos.get(segredoTts(p)));
  }
  async mascara(p?: ProvedorTts) {
    const k = p ? await this.segredos.get(segredoTts(p)) : undefined;
    return k ? '••••' + k.slice(-4) : undefined;
  }
  async remover(p?: ProvedorTts) {
    for (const id of p ? [p] : (['openai', 'elevenlabs', 'gemini'] as const)) {
      await this.segredos.delete?.(segredoTts(id));
      this.catalogos.delete(id);
    }
  }
  async audio(
    p: ProvedorTts,
    texto: string,
    op: { voz?: string; modelo?: string },
    sinal: AbortSignal,
  ): Promise<AudioTts> {
    const k = await this.segredos.get(segredoTts(p));
    if (!k) throw Error('Configure a chave deste provedor de voz.');
    protegerSegredo(k);
    const c = await this.catalogo(p);
    const modelo = op.modelo ?? c.modelos[0]?.id,
      voz =
        op.voz ??
        c.vozes.find((v) => v.id === (p === 'openai' ? 'marin' : 'Kore'))?.id ??
        c.vozes[0]?.id;
    const m = c.modelos.find((m) => m.id === modelo);
    if (!m || !c.vozes.some((v) => v.id === voz) || (m.vozes && !m.vozes.includes(voz)))
      throw Error('Modelo ou voz nao anunciado pelo provedor.');
    if (sinal.aborted) throw Error('Leitura cancelada.');
    return validarAudio(
      await this.provedores[p].sintetizar(k, {
        texto: mascarar(texto).slice(0, 1500),
        voz,
        modelo,
        sinal,
      }),
    );
  }
  private async http(p: ProvedorTts, k: string, d: PedidoTts): Promise<AudioTts> {
    const caminho =
      p === 'openai'
        ? '/v1/audio/speech'
        : p === 'elevenlabs'
          ? `/v1/text-to-speech/${encodeURIComponent(d.voz)}?output_format=mp3_44100_128&enable_logging=false`
          : '/v1beta/interactions';
    const body =
      p === 'openai'
        ? { model: d.modelo, input: d.texto, voice: d.voz, response_format: 'wav' }
        : p === 'elevenlabs'
          ? { model_id: d.modelo, text: d.texto }
          : {
              model: d.modelo,
              store: false,
              input: [{ type: 'user_input', content: [{ type: 'text', text: d.texto }] }],
              response_format: { type: 'audio' },
              generation_config: { speech_config: [{ voice: d.voz }] },
            };
    const r = await fetch(this.base(p) + caminho, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...this.headers(p, k) },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.any([d.sinal, AbortSignal.timeout(60000)]),
    });
    if (!r.ok) {
      let codigo = '';
      try {
        const j = JSON.parse((await lerAudioLimitado(r, 16000)).toString('utf8'));
        const c = j.detail?.status ?? j.error?.code;
        if (typeof c === 'string' && /^[a-z0-9_]{1,80}$/i.test(c)) codigo = c;
      } catch {}
      throw Error(
        `Provedor de voz recusou a sintese (HTTP ${r.status}${codigo ? ', ' + codigo : ''}). Verifique chave, permissao text_to_speech, cota e conexao.`,
      );
    }
    if (p !== 'gemini')
      return {
        dados: await lerAudioLimitado(r),
        mime: p === 'openai' ? 'audio/wav' : 'audio/mpeg',
      };
    const j = JSON.parse((await lerAudioLimitado(r, 28 * 1024 * 1024)).toString('utf8'));
    const partes = (j.steps ?? [])
      .filter((s: any) => s.type === 'model_output')
      .flatMap((s: any) => s.content ?? [])
      .filter((c: any) => c.type === 'audio');
    const audio = partes.at(-1) ?? j.output_audio;
    if (!audio?.data) throw Error('Gemini retornou resposta sem audio.');
    const dados = Buffer.from(audio.data, 'base64'),
      mime = audio.mime_type ?? audio.mimeType ?? 'audio/wav';
    if (dados.length > 20 * 1024 * 1024) throw Error('Audio excede o limite.');
    if (mime.startsWith('audio/l16') || mime.startsWith('audio/pcm'))
      return { dados: wavPcm(dados, 24000), mime: 'audio/wav' };
    if (mime !== 'audio/wav' && mime !== 'audio/mpeg')
      throw Error('Formato de audio Gemini nao suportado.');
    return { dados, mime };
  }
}
