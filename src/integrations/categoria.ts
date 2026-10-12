import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { CategoriaAcao } from '../shared/protocolo';
export function categoriaFerramenta(
  t: Pick<Tool, 'name' | 'annotations'>,
  integracao?: string,
): CategoriaAcao {
  const nome = t.name.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
  if (
    t.annotations?.destructiveHint ||
    /(?:^|[_\W])(delete|remove|drop|destroy|purge|truncate)/.test(nome)
  )
    return 'irreversivel_externo';
  if (t.annotations?.readOnlyHint === true) return 'rede_leitura';
  if (/(?:^|[_\W])(send|publish|post|reply|forward|merge|invite|share)|create_release/.test(nome))
    return 'publicacao';
  if (/(?:^|[_\W])(create|update|edit|write|insert|upload|move)/.test(nome))
    return integracao === 'github' ? 'publicacao' : 'externo';
  if (/(?:^|[_\W])(get|list|search|read|fetch|query)/.test(nome)) return 'rede_leitura';
  return 'externo';
}
