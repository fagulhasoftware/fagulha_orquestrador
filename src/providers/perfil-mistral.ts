import { open, readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

// O ACP persiste selecoes em config.toml, mesmo quando a alteracao e de sessao.
// Guarda somente em memoria, sem copiar .env/autenticacao para outro perfil.
export async function protegerPreferenciasVibe(pasta: string, sinal: AbortSignal) {
  const lock = join(pasta, '.fagulha-model.lock'),
    arquivo = join(pasta, 'config.toml');
  for (;;) {
    if (sinal.aborted) throw new Error('Execucao interrompida.');
    try {
      const h = await open(lock, 'wx', 0o600);
      await h.writeFile(JSON.stringify({ pid: process.pid }));
      await h.close();
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      try {
        const { pid } = JSON.parse(await readFile(lock, 'utf8'));
        if (Number.isInteger(pid) && pid > 0) {
          try {
            process.kill(pid, 0);
          } catch (erro) {
            if ((erro as NodeJS.ErrnoException).code === 'ESRCH') await unlink(lock);
          }
        }
      } catch {
        /* writer ainda pode estar preenchendo o lock */
      }
      await new Promise((r) => setTimeout(r, 30));
    }
  }
  const ler = async () =>
    readFile(arquivo).catch((e) => {
      if (e.code === 'ENOENT') return undefined;
      throw e;
    });
  let original: Buffer | undefined;
  try {
    original = await ler();
  } catch (e) {
    await unlink(lock);
    throw e;
  }
  let esperado = original;
  return {
    marcar: async () => {
      esperado = await ler();
    },
    restaurar: async () => {
      try {
        const atual = await ler();
        const igual =
          atual === undefined
            ? esperado === undefined
            : esperado !== undefined && atual.equals(esperado);
        // Nao sobrescreve edicoes feitas externamente enquanto o agente respondia.
        if (!igual) return false;
        if (original && atual?.equals(original)) return true;
        if (original) await writeFile(arquivo, original, { mode: 0o600 });
        else
          await unlink(arquivo).catch((e) => {
            if (e.code !== 'ENOENT') throw e;
          });
        return true;
      } finally {
        await unlink(lock);
      }
    },
  };
}
