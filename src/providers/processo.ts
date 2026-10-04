import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
export function matarArvore(pid: number | undefined, iniciar: typeof spawn = spawn): void {
  if (!pid) return;
  if (process.platform === 'win32') {
    const p = iniciar('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    const fallback = () => {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {}
    };
    p.once('error', fallback);
    p.once('exit', (code) => {
      if (code !== 0) fallback();
    });
  } else {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {}
    }
    const t = setTimeout(() => {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {}
    }, 1000);
    t.unref();
  }
}
export async function rodar(
  cmd: string,
  args: string[],
  opcoes: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    stdin?: string;
    sinal?: AbortSignal;
    linha?: (linha: string) => void;
    trecho?: (texto: string) => void;
    timeoutMs?: number;
  } = {},
): Promise<string> {
  if (opcoes.sinal?.aborted) throw new Error('Execucao interrompida.');
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd: opcoes.cwd,
      env: opcoes.env,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });
    let saida = '',
      erro = '',
      buffer = '',
      timeout = false;
    const decoder = new StringDecoder('utf8');
    const cancelar = () => matarArvore(proc.pid);
    const timer = setTimeout(
      () => {
        timeout = true;
        cancelar();
      },
      opcoes.timeoutMs ?? 20 * 60_000,
    );
    opcoes.sinal?.addEventListener('abort', cancelar, { once: true });
    proc.stdin.on('error', () => {});
    proc.stdin.end(opcoes.stdin ?? '');
    proc.stdout.on('data', (d: Buffer) => {
      const s = decoder.write(d);
      opcoes.trecho?.(s);
      saida = (saida + s).slice(-1_000_000);
      buffer += s;
      if (buffer.length > 2_000_000) {
        cancelar();
        return;
      }
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const l = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        try {
          opcoes.linha?.(l);
        } catch (e) {
          erro = String(e);
          cancelar();
        }
      }
    });
    proc.stderr.on('data', (d: Buffer) => {
      const texto = d.toString('utf8');
      erro = (erro + texto).slice(-4000);
      opcoes.trecho?.(texto);
    });
    const limpar = () => {
      clearTimeout(timer);
      opcoes.sinal?.removeEventListener('abort', cancelar);
    };
    proc.once('error', (e) => {
      limpar();
      reject(e);
    });
    proc.once('close', (code) => {
      limpar();
      buffer += decoder.end();
      if (buffer.trim())
        try {
          opcoes.linha?.(buffer);
        } catch (e) {
          reject(e);
          return;
        }
      if (timeout) {
        reject(new Error('Processo excedeu timeout.'));
        return;
      }
      if (opcoes.sinal?.aborted) reject(new Error('Execucao interrompida.'));
      else if (code !== 0) reject(new Error(`CLI saiu com codigo ${code}: ${erro.slice(-1000)}`));
      else resolve(saida);
    });
  });
}
