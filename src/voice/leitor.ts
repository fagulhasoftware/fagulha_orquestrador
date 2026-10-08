import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { EstadoVoz } from '../shared/protocolo';
import { executarVoz, type FabricaProcesso } from './processo';
import type { VozNuvem } from './nuvem';

export function textoParaLeitura(texto: string, limite = 1500): string {
  return texto
    .slice(0, 100_000)
    .replace(
      /```[^\n]*\n[\s\S]*?(?:```|$)|~~~[^\n]*\n[\s\S]*?(?:~~~|$)/g,
      ' trecho de codigo omitido ',
    )
    .replace(/^(?: {4}|\t).+(?:\r?\n(?: {4}|\t).+)*/gm, ' trecho de codigo omitido ')
    .replace(/`[^`]*`/g, ' trecho de codigo omitido ')
    .replace(/<(?:pre|code)\b[^>]*>[\s\S]*?<\/(?:pre|code)>/gi, ' trecho de codigo omitido ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/^\s*(?:#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_`~|]/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limite);
}
export const SCRIPT_FALAR =
  '[Console]::InputEncoding=[System.Text.Encoding]::UTF8; Add-Type -AssemblyName System.Speech; $d=[Console]::In.ReadToEnd() | ConvertFrom-Json; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; try { if ($d.voz) { $s.SelectVoice($d.voz) }; $s.Rate=[Math]::Max(-10,[Math]::Min(10,[Math]::Round([Math]::Log($d.velocidade,2)*10))); $s.Speak([string]$d.texto) } finally { $s.Dispose() }';
export function argumentosLeitura(
  so: NodeJS.Platform,
  _comando: string,
  arquivo: string,
  voz: string | undefined,
  velocidade: number,
): string[] {
  if (so === 'win32') return ['-NoProfile', '-NonInteractive', '-Command', SCRIPT_FALAR];
  if (so === 'darwin')
    return [...(voz ? ['-v', voz] : []), '-r', String(Math.round(175 * velocidade)), '-f', arquivo];
  return ['--stdin', '-s', String(Math.round(175 * velocidade)), ...(voz ? ['-v', voz] : [])];
}
export function argumentosPiper(
  modelo: string,
  arquivo: string,
  velocidade: number,
  variacao: number,
): string[] {
  return [
    '--model',
    modelo,
    '--output_file',
    arquivo,
    '--length_scale',
    String(1 / velocidade),
    '--noise_scale',
    String(0.25 + variacao * 0.6),
    '--noise_w',
    String(0.3 + variacao * 0.5),
  ];
}
export const SCRIPT_AUDIO =
  '[Console]::InputEncoding=[System.Text.Encoding]::UTF8; $d=[Console]::In.ReadToEnd() | ConvertFrom-Json; $s=New-Object System.Media.SoundPlayer; try { $s.SoundLocation=[string]$d.arquivo; $s.Load(); $s.PlaySync() } finally { $s.Dispose() }';
export class Leitor {
  private controle?: AbortController;
  private tarefa?: Promise<void>;
  private geracao = 0;
  constructor(
    private pasta: string,
    private fabrica?: FabricaProcesso,
    private so: NodeJS.Platform = process.platform,
    private neural?: { modelo?: () => string | undefined; nuvem?: VozNuvem },
  ) {}
  async parar(): Promise<void> {
    this.geracao++;
    this.controle?.abort();
    await this.tarefa?.catch(() => {});
  }
  async ler(comando: string, texto: string, leitura: EstadoVoz['leitura']): Promise<void> {
    const geracao = ++this.geracao;
    this.controle?.abort();
    await this.tarefa?.catch(() => {});
    if (geracao !== this.geracao) return;
    const controle = new AbortController();
    this.controle = controle;
    const tarefa = (async () => {
      let restante = textoParaLeitura(texto, 100000);
      while (restante && !controle.signal.aborted) {
        let fim = Math.min(1500, restante.length);
        if (fim < restante.length) {
          const espaco = restante.lastIndexOf(' ', fim);
          if (espaco > 1000) fim = espaco;
        }
        await this.falar(comando, restante.slice(0, fim), leitura, controle.signal);
        restante = restante.slice(fim).trimStart();
      }
    })();
    this.tarefa = tarefa;
    try {
      await tarefa;
    } finally {
      if (this.tarefa === tarefa) {
        this.tarefa = undefined;
        this.controle = undefined;
      }
    }
  }
  private async falar(
    comando: string,
    texto: string,
    leitura: EstadoVoz['leitura'],
    sinal: AbortSignal,
  ): Promise<void> {
    await mkdir(this.pasta, { recursive: true, mode: 0o700 });
    const pasta = await mkdtemp(join(this.pasta, 'leitura-'));
    const arquivo = join(pasta, 'texto.txt');
    try {
      if (!texto || sinal.aborted) return;
      if (leitura.motor !== 'sistema') {
        const audio = join(pasta, 'voz.wav');
        if (leitura.motor === 'piper') {
          const modelo = this.neural?.modelo?.();
          if (!modelo)
            throw new Error('Nenhuma voz neural com licenca comercial verificada instalada.');
          const r = await executarVoz(
            comando,
            argumentosPiper(modelo, audio, leitura.velocidade, leitura.variacao),
            { fabrica: this.fabrica, sinal, timeoutMs: 180000, entrada: texto + '\n' },
          );
          if (r.codigo !== 0) throw new Error('O Piper nao conseguiu sintetizar a fala.');
        } else {
          if (!this.neural?.nuvem || !leitura.nuvem.provedor)
            throw new Error('Configure a voz em nuvem antes de seleciona-la.');
          await this.neural.nuvem.sintetizar(leitura.nuvem.provedor, texto, audio, leitura, sinal);
        }
        if (sinal.aborted) return;
        const player =
          this.so === 'win32' ? 'powershell.exe' : this.so === 'darwin' ? 'afplay' : 'aplay';
        const args =
          this.so === 'win32'
            ? ['-NoProfile', '-NonInteractive', '-Command', SCRIPT_AUDIO]
            : [audio];
        const r = await executarVoz(player, args, {
          fabrica: this.fabrica,
          sinal,
          timeoutMs: 180000,
          entrada: this.so === 'win32' ? JSON.stringify({ arquivo: audio }) : '',
        });
        if (r.codigo !== 0) throw new Error('Nao foi possivel reproduzir o audio sintetizado.');
        return;
      }
      if (this.so === 'darwin') await writeFile(arquivo, texto, { mode: 0o600 });
      const r = await executarVoz(
        comando,
        argumentosLeitura(this.so, comando, arquivo, leitura.voz, leitura.velocidade),
        {
          fabrica: this.fabrica,
          sinal,
          timeoutMs: 180_000,
          entrada:
            this.so === 'win32'
              ? JSON.stringify({ texto, voz: leitura.voz, velocidade: leitura.velocidade })
              : this.so === 'darwin'
                ? ''
                : texto + '\n',
        },
      );
      if (r.codigo !== 0) throw new Error('A voz nativa não conseguiu ler esta mensagem.');
    } catch (e) {
      if (!sinal.aborted) throw e;
    } finally {
      await rm(pasta, { recursive: true, force: true });
    }
  }
}
