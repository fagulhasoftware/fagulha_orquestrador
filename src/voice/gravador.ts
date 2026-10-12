import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { criarProcesso, type FabricaProcesso, type ProcessoVoz } from './processo';

export function argumentosGravacao(
  so: NodeJS.Platform,
  dispositivo: string,
  wav: string,
  limite = 120,
): string[] {
  const entrada =
    so === 'win32'
      ? ['-f', 'dshow', '-i', `audio=${dispositivo}`]
      : so === 'darwin'
        ? ['-f', 'avfoundation', '-i', `:${dispositivo}`]
        : dispositivo.startsWith('alsa:')
          ? ['-f', 'alsa', '-i', dispositivo.slice(5)]
          : ['-f', 'pulse', '-i', dispositivo];
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    ...entrada,
    '-ac',
    '1',
    '-ar',
    '16000',
    '-c:a',
    'pcm_s16le',
    '-t',
    String(limite),
    wav,
  ];
}
export interface AudioGravado {
  pasta: string;
  wav: string;
  duracao: number;
}
export class Gravador {
  private atual?: {
    audio: AudioGravado;
    processo: ProcessoVoz;
    inicio: number;
    timer: NodeJS.Timeout;
    parado: boolean;
  };
  constructor(
    private pasta: string,
    private fabrica: FabricaProcesso = criarProcesso,
    private so: NodeJS.Platform = process.platform,
  ) {}
  get ativo(): boolean {
    return !!this.atual;
  }
  async iniciar(
    comando: string,
    dispositivo: string,
    tick: (segundos: number) => void,
    terminou: () => void,
    limite = 120,
  ): Promise<void> {
    if (this.atual) throw new Error('Já existe uma gravação em andamento.');
    await mkdir(this.pasta, { recursive: true, mode: 0o700 });
    const pasta = await mkdtemp(join(this.pasta, 'gravacao-'));
    const audio = { pasta, wav: join(pasta, 'audio.wav'), duracao: 0 };
    try {
      const processo = this.fabrica(
        comando,
        argumentosGravacao(this.so, dispositivo, audio.wav, limite),
      );
      const inicio = Date.now();
      const timer = setInterval(() => {
        tick(Math.min(limite, Math.floor((Date.now() - inicio) / 1000)));
        if (Date.now() - inicio >= limite * 1000) terminou();
      }, 1000);
      const atual = { audio, processo, inicio, timer, parado: false };
      this.atual = atual;
      // Também transcreve quando o -t do ffmpeg encerra a captura.
      void processo.resultado.then(
        () => {
          if (!atual.parado) terminou();
        },
        () => {
          if (!atual.parado) terminou();
        },
      );
      tick(0);
    } catch {
      await rm(pasta, { recursive: true, force: true });
      throw new Error('Não foi possível iniciar a gravação.');
    }
  }
  async parar(): Promise<AudioGravado | undefined> {
    const atual = this.atual;
    if (!atual || atual.parado) return undefined;
    atual.parado = true;
    clearInterval(atual.timer);
    atual.audio.duracao = Math.min(
      120,
      Math.max(1, Math.round((Date.now() - atual.inicio) / 1000)),
    );
    atual.processo.escrever('q\n');
    atual.processo.fecharEntrada();
    const timeout = setTimeout(() => atual.processo.cancelar(), 5000);
    try {
      const resultado = await atual.processo.resultado;
      if (resultado.codigo !== 0)
        throw new Error('Falha ao capturar o microfone. Verifique o dispositivo e as permissões.');
      return atual.audio;
    } catch {
      await this.limpar(atual.audio);
      throw new Error('Falha ao capturar o microfone. Verifique o dispositivo e as permissões.');
    } finally {
      clearTimeout(timeout);
      this.atual = undefined;
    }
  }
  async descartar(): Promise<void> {
    const audio = await this.parar().catch(() => undefined);
    if (audio) await this.limpar(audio);
  }
  async limpar(audio: AudioGravado): Promise<void> {
    await rm(audio.pasta, { recursive: true, force: true });
  }
}
