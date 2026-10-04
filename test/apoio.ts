import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Armazenamento } from '../src/storage/sqlite';
export async function temporario(): Promise<{ pasta: string; limpar: () => Promise<void> }> {
  const base = resolve('test', '.tmp');
  await mkdir(base, { recursive: true });
  const pasta = await mkdtemp(join(base, 'caso-'));
  return { pasta, limpar: () => rm(pasta, { recursive: true, force: true }) };
}
export async function banco(pasta: string): Promise<Armazenamento> {
  const s = new Armazenamento(join(pasta, 'dados.sqlite'));
  await s.iniciar();
  return s;
}
