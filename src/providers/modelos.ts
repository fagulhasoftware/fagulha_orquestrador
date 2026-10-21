import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { CatalogoModelos, ModeloOpcao } from '../shared/protocolo';
import { mascarar } from '../core/seguranca';

export interface ConfigModelos {
  modelos?: (string | ModeloOpcao)[];
}
export function modelosConfigurados(config: ConfigModelos): ModeloOpcao[] {
  return (config.modelos ?? [])
    .slice(0, 500)
    .map((m) => (typeof m === 'string' ? { id: m, nome: m } : m))
    .filter(
      (m) =>
        typeof m.id === 'string' &&
        !!m.id &&
        m.id.length <= 200 &&
        !/[\r\n\0]/.test(m.id) &&
        mascarar(m.id) === m.id,
    )
    .map((m) => ({
      id: m.id,
      nome: String(m.nome ?? m.id).slice(0, 200),
      esforcos: m.esforcos?.filter((e) => /^[a-z0-9_-]{1,40}$/.test(e)),
    }));
}
export function catalogoConfigurado(
  config: ConfigModelos,
  detalhe = 'Lista configuravel em fagulha.provedores.<id>.modelos.',
): CatalogoModelos {
  return { modelos: modelosConfigurados(config), origem: 'settings', detalhe };
}
export async function modelosCodex(): Promise<CatalogoModelos> {
  // Cache do proprio runtime; nunca le arquivos de autenticacao.
  const j = JSON.parse(
    await readFile(
      join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'models_cache.json'),
      'utf8',
    ),
  );
  return {
    origem: 'runtime',
    detalhe: 'Catalogo local do Codex; pode exigir atualizar o runtime para refletir a conta.',
    modelos: (j.models ?? [])
      .filter((m: any) => m.visibility === 'list')
      .map((m: any) => ({
        id: m.slug,
        nome: m.display_name ?? m.slug,
        esforcos: m.supported_reasoning_levels?.map((e: any) => e.effort),
      })),
  };
}
export function modelosAntigravity(texto: string): ModeloOpcao[] {
  return texto.split(/\r?\n/).flatMap((l) => {
    const m = l.trim().match(/^([\w.:-]+)\t+(.+)$/);
    // O catalogo nao informa esforcos por modelo. IDs podem codificar o esforco.
    return m ? [{ id: m[1], nome: m[2] }] : [];
  });
}
export function erroSelecaoModelo(texto: string): boolean {
  return /(?:model|modelo|effort|reasoning).*(?:not found|not available|unavailable|not supported|invalid|denied|permission|access|quota|limit|exhaust|capacity|indispon|inval|cota)|(?:quota|rate.?limit|resource.exhaust|insufficient_quota|capacity|credit|usage.limit|HTTP (?:403|404|429))|(?:unknown|invalid|unsupported|inaccessible).*(?:model|effort)/i.test(
    texto,
  );
}
