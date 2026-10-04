import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { EstadoVoz } from '../shared/protocolo';
import { executarVoz, type FabricaProcesso } from './processo';

export function textoParaLeitura(texto: string): string {
  return texto
    .slice(0, 100_000)
    .replace(
      /```[^\n]*\n[\s\S]*?(?:```|$)|~~~[^\n]*\n[\s\S]*?(?:~~~|$)/g,
      ' trecho de codigo omitido ',
    )
    .replace(/^(?: {4}|\t).+(?:\r?\n(?: {4}|\t).+)*/gm, ' trecho de codigo omitido ')
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
    .slice(0, 1500);
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
export class Leitor {
  private controle?: AbortController;
  private tarefa?: Promise<void>;
  private geracao = 0;
  constructor(
    private pasta: string,
    private fabrica?: FabricaProcesso,
    private so: NodeJS.Platform = process.platform,
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
    const tarefa = this.falar(comando, textoParaLeitura(texto), leitura, controle.signal);
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
