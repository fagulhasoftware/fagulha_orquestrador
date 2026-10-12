import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { dirname, isAbsolute } from 'node:path';
import { matarArvore } from '../providers/processo';

export interface ResultadoVoz {
  codigo: number | null;
  saida: string;
  erro: string;
}
export interface ProcessoVoz {
  resultado: Promise<ResultadoVoz>;
  escrever(texto: string): void;
  fecharEntrada(): void;
  cancelar(): void;
}
export type FabricaProcesso = (comando: string, args: string[]) => ProcessoVoz;
export const criarProcesso: FabricaProcesso = (comando, args) => {
  const filho = spawn(comando, args, {
    // Evita procurar DLLs/backends no workspace (incluindo código de terceiros).
    cwd: dirname(isAbsolute(comando) ? comando : process.execPath),
    shell: false,
    windowsHide: true,
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let saida = '';
  let erro = '';
  const stdout = new StringDecoder('utf8');
  const stderr = new StringDecoder('utf8');
  filho.stdin.on('error', () => {});
  filho.stdout.on('data', (d: Buffer) => {
    saida = (saida + stdout.write(d)).slice(-65536);
  });
  filho.stderr.on('data', (d: Buffer) => {
    erro = (erro + stderr.write(d)).slice(-65536);
  });
  const resultado = new Promise<ResultadoVoz>((resolve, reject) => {
    filho.once('error', () => reject(new Error('Não foi possível iniciar o componente de voz.')));
    filho.once('close', (codigo) =>
      resolve({ codigo, saida: saida + stdout.end(), erro: erro + stderr.end() }),
    );
  });
  // Evita rejeição não tratada enquanto o gravador ainda está sendo iniciado.
  void resultado.catch(() => {});
  return {
    resultado,
    escrever: (texto) => {
      if (!filho.stdin.destroyed) filho.stdin.write(texto);
    },
    fecharEntrada: () => {
      filho.stdin.end();
    },
    cancelar: () => {
      matarArvore(filho.pid);
    },
  };
};
export async function executarVoz(
  comando: string,
  args: string[],
  opcoes: {
    fabrica?: FabricaProcesso;
    timeoutMs?: number;
    sinal?: AbortSignal;
    entrada?: string;
  } = {},
): Promise<ResultadoVoz> {
  if (opcoes.sinal?.aborted) throw new Error('Operação de voz cancelada.');
  const p = (opcoes.fabrica ?? criarProcesso)(comando, args);
  let timeout = false;
  const cancelar = () => p.cancelar();
  const timer = setTimeout(() => {
    timeout = true;
    cancelar();
  }, opcoes.timeoutMs ?? 5000);
  opcoes.sinal?.addEventListener('abort', cancelar, { once: true });
  p.escrever(opcoes.entrada ?? '');
  p.fecharEntrada();
  try {
    const r = await p.resultado;
    if (opcoes.sinal?.aborted) throw new Error('Operação de voz cancelada.');
    if (timeout) throw new Error('O componente de voz excedeu o tempo limite.');
    return r;
  } finally {
    clearTimeout(timer);
    opcoes.sinal?.removeEventListener('abort', cancelar);
  }
}
