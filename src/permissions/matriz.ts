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
  'memoria',
  'irreversivel_externo',
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
    memoria: 'aprovar',
    irreversivel_externo: 'aprovar',
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
    memoria: 'aprovar',
    irreversivel_externo: 'aprovar',
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
    publicacao: 'automatica',
    credencial: 'automatica',
    destrutiva: 'automatica',
    memoria: 'automatica',
    irreversivel_externo: 'aprovar',
  },
};
export function critica(c: CategoriaAcao): boolean {
  return ['publicacao', 'credencial', 'destrutiva', 'memoria', 'irreversivel_externo'].includes(c);
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
      'irreversivel_externo',
    ].includes(categoria)
  )
    return 'negada';
  if (modo === 'escrita' && ['leitura_workspace', 'leitura_maquina'].includes(categoria))
    return 'negada';
  return matriz[nivel][categoria];
}
