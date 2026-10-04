import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { basename, join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { ContextoImportado } from '../shared/protocolo';
import { caminhoReal, mascarar, sensivel } from '../core/seguranca';
export interface CandidatoContexto {
  caminho: string;
  origem: ContextoImportado['origem'];
  titulo: string;
}
export interface ContextoCompleto {
  meta: ContextoImportado;
  texto: string;
}
export async function descobrirContextos(raiz = homedir()): Promise<CandidatoContexto[]> {
  const saida: CandidatoContexto[] = [];
  const buscar = async (
    pasta: string,
    origem: CandidatoContexto['origem'],
    profundidade = 0,
  ): Promise<void> => {
    if (profundidade > 6 || saida.length >= 500) return;
    let entries;
    try {
      entries = await readdir(pasta, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (saida.length >= 500) break;
      if (e.isSymbolicLink() || sensivel(e.name)) continue;
      const caminho = join(pasta, e.name);
      if (e.isDirectory()) await buscar(caminho, origem, profundidade + 1);
      else if (/\.(jsonl|log|md)$/i.test(e.name)) saida.push({ caminho, origem, titulo: e.name });
    }
  };
  await buscar(join(raiz, '.claude', 'projects'), 'claude-code');
  await buscar(join(raiz, '.codex', 'sessions'), 'codex');
  await buscar(join(raiz, '.orquestra', 'sala', 'logs'), 'sala-terminal');
  return saida;
}
function extrair(j: any): string[] {
  if (j.type === 'user' || j.type === 'assistant') {
    const c = j.message?.content;
    return typeof c === 'string'
      ? [`${j.type}: ${c}`]
      : Array.isArray(c)
        ? c.filter((x) => x.type === 'text').map((x) => `${j.type}: ${x.text}`)
        : [];
  }
  const p = j.payload;
  if (j.type === 'response_item' && p?.type === 'message')
    return (p.content ?? [])
      .filter((c: any) => ['input_text', 'output_text'].includes(c.type))
      .map((c: any) => `${p.role}: ${c.text}`);
  if (j.type === 'event_msg' && ['user_message', 'agent_message'].includes(p?.type))
    return [`${p.type}: ${p.message}`];
  return [];
}
export async function importarContexto(
  c: CandidatoContexto,
  orcamento = 12_000,
): Promise<ContextoCompleto> {
  const real = await caminhoReal(c.caminho);
  const info = await stat(real);
  // Ultimos 8 MB bastam para ultimas falas, sem carregar arquivos de sessao gigantes.
  const inicio = Math.max(0, info.size - 8 * 1024 * 1024);
  const stream = createReadStream(real, { start: inicio });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let texto = '',
    primeira = true;
  try {
    for await (const linha of rl) {
      if (primeira && inicio > 0) {
        primeira = false;
        continue;
      }
      primeira = false;
      if (linha.length > 512 * 1024) continue;
      let partes: string[] = [];
      if (/\.jsonl$/i.test(real)) {
        try {
          partes = extrair(JSON.parse(linha));
        } catch {
          continue;
        }
      } else partes = [linha];
      for (const parte of partes)
        texto = (texto + mascarar(parte) + '\n').slice(-Math.min(orcamento, 12_000));
    }
  } finally {
    rl.close();
    stream.destroy();
  }
  if (!texto.trim()) throw new Error('Nenhuma mensagem de conversa encontrada.');
  return {
    meta: {
      id: randomUUID(),
      origem: c.origem,
      titulo: c.titulo || basename(real),
      caracteres: texto.length,
    },
    texto,
  };
}
