import type { DoHost, DoWebview } from '../shared/protocolo';
import { ErroFerramenta } from '../mcp/erros';
import type { Integracoes } from './gestor';
export function separarComando(texto: string): { comando: string; args: string[] } {
  const itens: string[] = [];
  let atual = '',
    aspas = '',
    iniciado = false;
  for (const c of texto.trim()) {
    if (aspas) {
      if (c === aspas) aspas = '';
      else atual += c;
      iniciado = true;
    } else if (c === '"' || c === "'") {
      aspas = c;
      iniciado = true;
    } else if (/\s/.test(c)) {
      if (iniciado) {
        itens.push(atual);
        atual = '';
        iniciado = false;
      }
    } else {
      atual += c;
      iniciado = true;
    }
  }
  if (aspas) throw new ErroFerramenta('Incomplete quotes in the stdio command.');
  if (iniciado) itens.push(atual);
  if (!itens[0]) throw new ErroFerramenta('Enter a stdio command.');
  return { comando: itens[0], args: itens.slice(1) };
}
export async function mensagemIntegracao(
  gestor: Integracoes,
  m: DoWebview,
  emitir: (e: DoHost) => void,
): Promise<boolean> {
  switch (m.tipo) {
    case 'listarIntegracoes':
      emitir({ tipo: 'integracoes', lista: gestor.listar() });
      await gestor.ferramentas();
      emitir({ tipo: 'integracoes', lista: gestor.listar() });
      return true;
    case 'conectarIntegracao':
      await gestor.conectar(
        m.id,
        Object.fromEntries(Object.entries(m.valores).filter(([, v]) => v !== '')),
      );
      return true;
    case 'desconectarIntegracao':
      await gestor.desconectar(m.id);
      return true;
    case 'alternarIntegracao':
      await gestor.alternar(m.id, m.ativa);
      await gestor.ferramentas();
      return true;
    case 'removerIntegracao':
      await gestor.remover(m.id);
      return true;
    case 'adicionarIntegracaoPersonalizada':
      if (!['token', 'nenhuma'].includes(m.autenticacao))
        throw new ErroFerramenta('OAuth is planned for phase 0.4.0-b.');
      await gestor.adicionar({
        nome: m.nome,
        transporte: m.transporte,
        autenticacao: m.autenticacao,
        ...(m.transporte === 'stdio' ? separarComando(m.endpoint) : { url: m.endpoint }),
      });
      return true;
    case 'listarSkills':
      emitir({ tipo: 'skills', lista: [] });
      return true;
    case 'importarSkill':
    case 'alternarSkill':
    case 'removerSkill':
    case 'verSkill':
      throw new ErroFerramenta('Skills are planned for phase 0.4.0-c.');
    default:
      return false;
  }
}
