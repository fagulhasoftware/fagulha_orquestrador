import type { Configuracao } from '../shared/protocolo';
import { userInfo } from 'node:os';
export const limitesMaximos: Configuracao['limites'] = {
  textoIntegralKB: 512,
  textoMaxMB: 2,
  imagemMaxMB: 10,
  documentoMaxMB: 20,
  planilhaMaxMB: 5,
  planilhaLinhasPorAba: 50,
  planilhaAbas: 5,
};
export function limitar(limites: Partial<Configuracao['limites']> = {}): Configuracao['limites'] {
  const saida = { ...limitesMaximos };
  for (const k of Object.keys(saida) as (keyof typeof saida)[]) {
    const valor = limites[k];
    if (valor !== undefined && Number.isFinite(valor) && valor > 0)
      saida[k] = Math.min(valor, saida[k]);
  }
  saida.planilhaAbas = Math.max(1, Math.floor(saida.planilhaAbas));
  saida.planilhaLinhasPorAba = Math.max(1, Math.floor(saida.planilhaLinhasPorAba));
  return saida;
}
export function nickPadrao(obterUsuario: () => string = () => userInfo().username): string {
  try {
    return obterUsuario().trim() || 'Voce';
  } catch {
    return 'Voce';
  }
}
export function configuracaoPadrao(): Configuracao {
  return {
    nivel: 'manual',
    passagensAutomaticas: 6,
    timeoutMinutos: 20,
    nick: nickPadrao(),
    topico: 'Sala de desenvolvimento. Mencione um agente para acionar.',
    limites: { ...limitesMaximos },
  };
}
