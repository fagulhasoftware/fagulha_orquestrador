import { randomUUID } from 'node:crypto';
import type {
  Configuracao,
  ModoAgente,
  CategoriaAcao,
  PedidoAprovacao,
  DecisaoAprovacao,
  DoHost,
} from '../shared/protocolo';
import { decidir, critica } from './matriz';
import { mascarar } from '../core/seguranca';
export interface Acao {
  agente: string;
  modo: ModoAgente;
  categoria: CategoriaAcao;
  resumo: string;
  detalhe: string;
  critica?: boolean;
}
export class Portao {
  readonly pendentes = new Map<string, PedidoAprovacao>();
  private respostas = new Map<string, (d: DecisaoAprovacao | 'expirada') => void>();
  private autorizadas = new Set<string>();
  constructor(
    private config: () => Configuracao,
    private emitir: (evento: DoHost) => void,
    private auditar: (registro: unknown) => Promise<void>,
    private prazoMs = 120_000,
  ) {}
  limparSessao(agente?: string): void {
    for (const chave of this.autorizadas)
      if (!agente || chave.startsWith(agente + '\0')) this.autorizadas.delete(chave);
    for (const p of this.pendentes.values())
      if (!agente || p.agente === agente) this.responder(p.id, 'negar');
  }
  responder(id: string, decisao: DecisaoAprovacao): void {
    this.respostas.get(id)?.(decisao);
  }
  async executar<T>(acao: Acao, efeito: () => Promise<T>, sinal?: AbortSignal): Promise<T> {
    const config = this.config();
    const decisao = decidir(config.nivel, acao.modo, acao.categoria);
    const eCritica = critica(acao.categoria) || !!acao.critica;
    const chave = `${acao.agente}\0${config.nivel}\0${acao.modo}\0${acao.categoria}\0${acao.detalhe}`;
    let resultado: DecisaoAprovacao | 'expirada' | 'automatica' =
      decisao === 'negada' ? 'negar' : 'automatica';
    const resumo = mascarar(acao.resumo),
      detalhe = mascarar(acao.detalhe);
    this.emitir({
      tipo: 'mensagem',
      mensagem: {
        id: randomUUID(),
        sala: '',
        quando: new Date().toISOString(),
        autor: acao.agente,
        tipo: 'acao',
        texto: resumo,
      },
    });
    if (sinal?.aborted) resultado = 'negar';
    else if (
      decisao !== 'negada' &&
      (eCritica || (decisao === 'aprovar' && !this.autorizadas.has(chave)))
    ) {
      const pedido: PedidoAprovacao = {
        id: randomUUID(),
        agente: acao.agente,
        categoria: acao.categoria,
        resumo,
        detalhe,
        critica: eCritica,
        expiraEm: new Date(Date.now() + this.prazoMs).toISOString(),
      };
      resultado = await new Promise<DecisaoAprovacao | 'expirada'>((resolve) => {
        const terminar = (d: DecisaoAprovacao | 'expirada') => {
          clearTimeout(timer);
          sinal?.removeEventListener('abort', cancelar);
          this.respostas.delete(pedido.id);
          this.pendentes.delete(pedido.id);
          this.emitir({ tipo: 'aprovacaoResolvida', id: pedido.id, decisao: d });
          resolve(d);
        };
        const cancelar = () => terminar('negar');
        const timer = setTimeout(() => terminar('expirada'), this.prazoMs);
        this.pendentes.set(pedido.id, pedido);
        this.respostas.set(pedido.id, terminar);
        sinal?.addEventListener('abort', cancelar, { once: true });
        this.emitir({ tipo: 'aprovacao', pedido });
      });
      if (resultado === 'aprovar_sessao' && !eCritica) this.autorizadas.add(chave);
    }
    await this.auditar({
      ...acao,
      resumo,
      detalhe,
      id: randomUUID(),
      nivel: config.nivel,
      decisao: resultado,
      quando: new Date().toISOString(),
    });
    if (resultado === 'negar' || resultado === 'expirada' || sinal?.aborted)
      throw new Error('Acao negada ou aprovacao expirada.');
    return efeito();
  }
}
