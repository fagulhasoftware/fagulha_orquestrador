import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Agente, EstadoVoz } from '../shared/protocolo';
import { executarVoz, type FabricaProcesso } from './processo';
import type { AudioGravado } from './gravador';

export function normalizarMencoes(
  texto: string,
  agentes: Pick<Agente, 'nick' | 'id' | 'apelidos'>[],
): string {
  const nomes = new Map<string, string>([['todos', 'todos']]);
  for (const a of agentes)
    for (const alias of [a.id, a.nick, ...a.apelidos])
      nomes.set(alias.toLocaleLowerCase('pt'), a.nick);
  const alternativas = [...nomes.keys()]
    .sort((a, b) => b.length - a.length)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp(`\\barroba\\s+(${alternativas.join('|')})(?![\\p{L}\\p{N}_])`, 'giu');
  return texto
    .replace(regex, (_m, nome: string) => '@' + nomes.get(nome.toLocaleLowerCase('pt')))
    .trim();
}
export function argumentosTranscricao(
  modelo: string,
  wav: string,
  idioma: EstadoVoz['idioma'],
  saida: string,
): string[] {
  return ['-m', modelo, '-f', wav, '-l', idioma, '-otxt', '-of', saida, '-nt', '-np'];
}
export async function transcrever(
  comando: string,
  modelo: string,
  idioma: EstadoVoz['idioma'],
  audio: AudioGravado,
  sinal: AbortSignal,
  fabrica?: FabricaProcesso,
): Promise<string> {
  if (!(await stat(audio.wav)).size) throw new Error('A gravação ficou vazia. Tente novamente.');
  const saida = join(audio.pasta, 'transcricao');
  const r = await executarVoz(comando, argumentosTranscricao(modelo, audio.wav, idioma, saida), {
    fabrica,
    sinal,
    timeoutMs: Math.max(60_000, audio.duracao * 10_000),
  });
  if (r.codigo !== 0)
    throw new Error(
      'Não foi possível transcrever com o modelo local. Verifique os componentes de voz.',
    );
  const texto = (await readFile(saida + '.txt', 'utf8')).trim().slice(0, 20_000);
  if (!texto) throw new Error('Nenhuma fala foi reconhecida. Tente novamente.');
  return texto;
}
