import { basename, resolve } from 'node:path';
import type { Mensagem, ResumoChat } from '../shared/protocolo';
import { mascarar } from '../core/seguranca';

export interface ChatPersistido extends Omit<ResumoChat, 'desteProjeto' | 'trecho'> {
  tituloDefinido: boolean;
  usuarios: string[];
  anexosPendentes: string[];
  salaLegada?: string;
}
export function mesmoProjeto(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  const normalizar = (p: string) =>
    process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p);
  return normalizar(a) === normalizar(b);
}
export function tituloMensagem(texto: string, quando: string): string {
  const limpo = mascarar(texto)
    .replace(/(?:^|(?<=[^\p{L}\p{N}_@]))@[\p{L}\p{N}_:-]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return limpo.slice(0, 60) || `Conversa de ${quando.slice(0, 10)}`;
}
export function criarRegistroChat(
  id: string,
  projeto: string | null,
  usuario: string,
  quando = new Date().toISOString(),
): ChatPersistido {
  return {
    id,
    titulo: `Conversa de ${quando.slice(0, 10)}`,
    projeto,
    projetoNome: projeto ? basename(projeto) : null,
    criadoEm: quando,
    atualizadoEm: quando,
    mensagens: 0,
    agentes: [],
    fixado: false,
    tituloDefinido: false,
    usuarios: [usuario],
    anexosPendentes: [],
  };
}
export function resumoChat(chat: ChatPersistido, projeto: string | null): ResumoChat {
  const { tituloDefinido, usuarios, anexosPendentes, salaLegada, ...resumo } = chat;
  return { ...resumo, desteProjeto: mesmoProjeto(chat.projeto, projeto) };
}
export function normalizarBusca(texto: string): string {
  return texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}
export function trechoMensagem(conteudo: string, busca: string): string | undefined {
  const texto = mascarar(conteudo)
    .replace(/<[^>]*>/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#~|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const posicao = normalizarBusca(texto).indexOf(busca);
  if (posicao < 0) return undefined;
  const inicio = Math.max(0, posicao - 45);
  return `${inicio ? '…' : ''}${texto.slice(inicio, inicio + 160)}${texto.length > inicio + 160 ? '…' : ''}`;
}
