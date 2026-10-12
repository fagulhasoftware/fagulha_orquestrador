import { writeFile } from 'node:fs/promises';
import type { Segredos } from '../providers/tipos';
import { validarChave } from '../providers/login';
import { protegerSegredo, mascarar } from '../core/seguranca';
export type ProvedorTts = 'openai' | 'elevenlabs';
export const segredoTts = (p: ProvedorTts) => `fagulha.voz.${p}`;
export class VozNuvem {
  constructor(
    private segredos: Segredos,
    private endpointTeste?: string,
    private timeoutMs = 15000,
  ) {}
  async validar(provedor: ProvedorTts, chave: string): Promise<{ id: string; nome: string }[]> {
    protegerSegredo(chave);
    if (provedor === 'openai') {
      await validarChave('openai', chave, {
        endpointTeste: this.endpointTeste ? `${this.endpointTeste}/models` : undefined,
        timeoutMs: this.timeoutMs,
      });
      return [
        'alloy',
        'ash',
        'ballad',
        'coral',
        'echo',
        'fable',
        'nova',
        'onyx',
        'sage',
        'shimmer',
      ].map((id) => ({ id, nome: id }));
    }
    if (!/^[A-Za-z0-9_-]{20,4096}$/.test(chave))
      throw new Error('O formato da chave de voz e invalido.');
    try {
      const r = await fetch(`${this.endpointTeste ?? 'https://api.elevenlabs.io/v1'}/voices`, {
        headers: { 'xi-api-key': chave },
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (r.status === 401 || r.status === 403) throw new Error('Chave recusada pelo provedor.');
      if (!r.ok) throw new Error('Nao foi possivel validar a chave de voz.');
      const dados = JSON.parse((await this.limitado(r, 1_000_000)).toString('utf8'));
      const vozes = (dados.voices ?? [])
        .slice(0, 100)
        .filter((v: any) => /^[\w-]{1,200}$/.test(v.voice_id) && typeof v.name === 'string')
        .map((v: any) => ({ id: v.voice_id, nome: mascarar(v.name).slice(0, 200) }));
      if (!vozes.length)
        throw new Error(
          'Nenhuma voz disponivel para esta chave. Verifique as permissoes no provedor.',
        );
      return vozes;
    } catch (e) {
      if (e instanceof Error && /^(Chave recusada|Nenhuma voz)/.test(e.message)) throw e;
      throw new Error(
        'Nao foi possivel validar a chave de voz. Verifique a conexao e tente novamente.',
      );
    }
  }
  async salvar(provedor: ProvedorTts, chave: string): Promise<{ id: string; nome: string }[]> {
    const vozes = await this.validar(provedor, chave);
    await this.segredos.store(segredoTts(provedor), chave);
    return vozes;
  }
  async configurada(provedor?: ProvedorTts): Promise<boolean> {
    return !!provedor && !!(await this.segredos.get(segredoTts(provedor)));
  }
  async remover(): Promise<void> {
    for (const p of ['openai', 'elevenlabs'] as const) await this.segredos.delete?.(segredoTts(p));
  }
  private async limitado(r: Response, limite: number): Promise<Buffer> {
    const partes: Buffer[] = [];
    let bytes = 0;
    if (!r.body) throw new Error('Resposta de voz vazia.');
    for await (const parte of r.body as unknown as AsyncIterable<Uint8Array>) {
      bytes += parte.length;
      if (bytes > limite) throw new Error('Resposta de voz excede o limite.');
      partes.push(Buffer.from(parte));
    }
    return Buffer.concat(partes);
  }
  async sintetizar(
    provedor: ProvedorTts,
    texto: string,
    arquivo: string,
    leitura: { voz?: string; velocidade: number; variacao: number },
    sinal: AbortSignal,
  ): Promise<void> {
    const chave = await this.segredos.get(segredoTts(provedor));
    if (!chave) throw new Error('Configure uma chave validada para a voz em nuvem.');
    protegerSegredo(chave);
    const voz = leitura.voz ?? (provedor === 'openai' ? 'coral' : undefined);
    if (!voz || !/^[\w-]{1,200}$/.test(voz)) throw new Error('Selecione uma voz do provedor.');
    const url =
      provedor === 'openai'
        ? `${this.endpointTeste ?? 'https://api.openai.com/v1'}/audio/speech`
        : `${this.endpointTeste ?? 'https://api.elevenlabs.io/v1'}/text-to-speech/${voz}?output_format=pcm_24000`;
    const body =
      provedor === 'openai'
        ? {
            model: 'gpt-4o-mini-tts',
            voice: voz,
            input: mascarar(texto).slice(0, 1500),
            speed: leitura.velocidade,
            response_format: 'wav',
            instructions: `Fale em portugues brasileiro com frases naturais e curtas. Variacao de entonacao: ${leitura.variacao}.`,
          }
        : {
            text: mascarar(texto).slice(0, 1500),
            model_id: 'eleven_multilingual_v2',
            voice_settings: {
              stability: 1 - leitura.variacao,
              similarity_boost: 0.75,
              style: leitura.variacao,
              speed: Math.max(0.7, Math.min(1.2, leitura.velocidade)),
            },
          };
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(provedor === 'openai'
            ? { authorization: `Bearer ${chave}` }
            : { 'xi-api-key': chave }),
        },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.any([sinal, AbortSignal.timeout(60000)]),
      });
      if (!r.ok) {
        await r.body?.cancel();
        throw new Error();
      }
      let audio = await this.limitado(r, 20 * 1024 * 1024);
      if (provedor === 'elevenlabs') audio = wavPcm(audio, 24000);
      await writeFile(arquivo, audio, { mode: 0o600, flag: 'wx' });
    } catch {
      throw new Error(
        sinal.aborted
          ? 'Leitura cancelada.'
          : 'Nao foi possivel sintetizar a voz no provedor. Verifique a chave, o saldo e a conexao.',
      );
    }
  }
}

export function wavPcm(pcm: Buffer, taxa: number): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(pcm.length + 36, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(taxa, 24);
  h.writeUInt32LE(taxa * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
