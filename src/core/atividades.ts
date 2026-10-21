import type { Mensagem, TurnoAtividade } from '../shared/protocolo';
export type BlocoConversa =
  | { tipo: 'mensagem'; mensagem: Mensagem }
  | { tipo: 'atividades'; id: string; autor: string; acoes: Mensagem[]; turno?: TurnoAtividade };
export function agruparAtividades(
  mensagens: Mensagem[],
  turnos: TurnoAtividade[] = [],
): BlocoConversa[] {
  const saida: BlocoConversa[] = [],
    grupos = new Map<string, Extract<BlocoConversa, { tipo: 'atividades' }>>();
  const porId = new Map(turnos.map((t) => [t.id, t]));
  let legado = '';
  for (const m of mensagens) {
    if (m.parcial) continue;
    const atividade = m.tipo === 'acao' || (m.tipo === 'sistema' && !!m.requisicaoId);
    if (!atividade) {
      saida.push({ tipo: 'mensagem', mensagem: m });
      legado = '';
      continue;
    }
    const chave =
      m.requisicaoId ?? (legado.startsWith(m.autor + '\0') ? legado : m.autor + '\0' + m.id);
    legado = chave;
    let grupo = grupos.get(chave);
    if (!grupo) {
      grupo = {
        tipo: 'atividades',
        id: chave,
        autor: porId.get(chave)?.autor ?? m.autor,
        acoes: [],
        turno: porId.get(chave),
      };
      grupos.set(chave, grupo);
      saida.push(grupo);
    }
    grupo.acoes.push(m);
  }
  for (const t of turnos.filter((t) => !t.fim))
    if (!grupos.has(t.id))
      saida.push({ tipo: 'atividades', id: t.id, autor: t.autor, acoes: [], turno: t });
  return saida;
}
export function tituloAtividade(texto: string): string {
  if (/raciocin|reason|thinking|pensando/i.test(texto)) return 'Raciocinio';
  if (/shell|comando|command|terminal|execu/i.test(texto)) return 'Executar comando';
  if (/write|edit|escrev|altera|patch/i.test(texto)) return 'Escrita de arquivos';
  if (/auth|autentic|login|conta|perfil/i.test(texto)) return 'Autenticacao';
  if (/context|sessao|session|retom/i.test(texto)) return 'Preparar contexto';
  if (/mcp|conex|conect|rede|https?:/i.test(texto)) return 'Conexoes';
  if (/read|ler|leitura|arquivo/i.test(texto)) return 'Leitura';
  return 'Atividade';
}
