import type { CategoriaAcao, ModoAgente, NivelPermissao } from '../shared/protocolo';
export type Decisao = 'automatica' | 'aprovar' | 'negada';
export const categorias: CategoriaAcao[] = [
  'leitura_workspace',
  'escrita_workspace',
  'leitura_maquina',
  'escrita_maquina',
  'comando',
  'rede_leitura',
  'navegador',
  'externo',
  'publicacao',
  'credencial',
  'destrutiva',
];
export const matriz: Record<NivelPermissao, Record<CategoriaAcao, Decisao>> = {
  manual: {
    leitura_workspace: 'aprovar',
    escrita_workspace: 'aprovar',
    leitura_maquina: 'aprovar',
    escrita_maquina: 'aprovar',
    comando: 'aprovar',
    rede_leitura: 'aprovar',
    navegador: 'aprovar',
    externo: 'aprovar',
    publicacao: 'aprovar',
    credencial: 'aprovar',
    destrutiva: 'aprovar',
  },
  parcial: {
    leitura_workspace: 'automatica',
    escrita_workspace: 'automatica',
    leitura_maquina: 'aprovar',
    escrita_maquina: 'aprovar',
    comando: 'aprovar',
    rede_leitura: 'aprovar',
    navegador: 'aprovar',
    externo: 'aprovar',
    publicacao: 'aprovar',
    credencial: 'aprovar',
    destrutiva: 'aprovar',
  },
  total: {
    leitura_workspace: 'automatica',
    escrita_workspace: 'automatica',
    leitura_maquina: 'automatica',
    escrita_maquina: 'automatica',
    comando: 'automatica',
    rede_leitura: 'automatica',
    navegador: 'automatica',
    externo: 'automatica',
    publicacao: 'aprovar',
    credencial: 'aprovar',
    destrutiva: 'aprovar',
  },
};
export function critica(c: CategoriaAcao): boolean {
  return ['publicacao', 'credencial', 'destrutiva'].includes(c);
}
export function decidir(
  nivel: NivelPermissao,
  modo: ModoAgente,
  categoria: CategoriaAcao,
): Decisao {
  if (
    modo === 'leitura' &&
    [
      'escrita_workspace',
      'escrita_maquina',
      'comando',
      'externo',
      'publicacao',
      'credencial',
      'destrutiva',
    ].includes(categoria)
  )
    return 'negada';
  if (modo === 'escrita' && ['leitura_workspace', 'leitura_maquina'].includes(categoria))
    return 'negada';
  return matriz[nivel][categoria];
}
