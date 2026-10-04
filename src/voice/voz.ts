import { rodar } from '../providers/processo';
export interface EstadoVoz {
  disponivel: boolean;
  motivo?: string;
  gravando: boolean;
  ffmpeg?: boolean;
  whisper?: boolean;
}
export interface Voz {
  detectar(): Promise<EstadoVoz>;
  iniciar(): Promise<void>;
  parar(): Promise<string | undefined>;
}
export class VozLocal implements Voz {
  async detectar(): Promise<EstadoVoz> {
    const [ffmpeg, whisper] = await Promise.all([
      rodar('ffmpeg', ['-version'], { timeoutMs: 3000 }).then(
        () => true,
        () => false,
      ),
      rodar('whisper-cli', ['--help'], { timeoutMs: 3000 }).then(
        () => true,
        () => false,
      ),
    ]);
    return {
      disponivel: false,
      gravando: false,
      ffmpeg,
      whisper,
      motivo:
        !ffmpeg || !whisper
          ? 'Voz local requer ffmpeg e whisper.cpp no PATH, mais modelo local. Instale somente por escolha explicita.'
          : 'Ferramentas detectadas. Gravacao DirectShow e modelo local aguardam F1b.',
    };
  }
  async iniciar(): Promise<void> {
    throw new Error((await this.detectar()).motivo);
  }
  async parar(): Promise<undefined> {
    return undefined;
  }
}
