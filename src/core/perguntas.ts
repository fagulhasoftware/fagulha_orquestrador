import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { DoHost, PerguntaAgente, RespostaItem } from '../shared/protocolo';
import { mascarar } from './seguranca';

const curto = z.string().trim().min(1).max(500);
export const esquemaPergunta = z
  .object({
    titulo: curto.optional(),
    perguntas: z
      .array(
        z
          .object({
            id: z.string().regex(/^[\w-]{1,80}$/),
            pergunta: curto,
            opcoes: z
              .array(
                z
                  .object({
                    rotulo: curto,
                    descricao: curto.optional(),
                    recomendada: z.boolean().optional(),
                  })
                  .strict(),
              )
              .min(2)
              .max(6),
            multipla: z.boolean().optional(),
            permiteTexto: z.boolean().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(4),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (new Set(p.perguntas.map((q) => q.id)).size !== p.perguntas.length)
      ctx.addIssue({ code: 'custom', message: 'IDs de perguntas repetidos.' });
    for (const q of p.perguntas)
      if (new Set(q.opcoes.map((o) => o.rotulo)).size !== q.opcoes.length)
        ctx.addIssue({ code: 'custom', message: 'Opcoes repetidas.' });
  });
export interface RegistroPergunta extends PerguntaAgente {
  situacao?: 'respondida' | 'cancelada' | 'expirada';
  respostas?: RespostaItem[];
  donoPid: number;
}
export class Perguntas {
  get bloqueada(): boolean {
    return this.pendentes.size > 0 || this.finalizacoes.size > 0;
  }
  private finalizacoes = new Set<Promise<void>>();
  readonly pendentes = new Map<string, PerguntaAgente>();
  private resolvers = new Map<
    string,
    (situacao: NonNullable<RegistroPergunta['situacao']>, respostas?: RespostaItem[]) => void
  >();
  constructor(
    private emitir: (e: DoHost) => void,
    private salvar: (p: RegistroPergunta) => Promise<void>,
    private historico: (agente: string, texto: string, usuario?: boolean) => void,
    private timeoutMs = 30 * 60_000,
  ) {}
  async perguntar(agente: string, entrada: unknown, sinal: AbortSignal): Promise<unknown> {
    const parsed = esquemaPergunta.parse(entrada);
    if (sinal.aborted) return { situacao: 'cancelada', respostas: [] };
    const dados = esquemaPergunta.parse(JSON.parse(mascarar(JSON.stringify(parsed))));
    const p: RegistroPergunta = {
      ...dados,
      id: randomUUID(),
      agente,
      criadaEm: new Date().toISOString(),
      expiraEm: new Date(Date.now() + this.timeoutMs).toISOString(),
      donoPid: process.pid,
    };
    await this.salvar(p);
    if (sinal.aborted) {
      await this.salvar({ ...p, situacao: 'cancelada' });
      return { situacao: 'cancelada', respostas: [] };
    }
    this.historico(
      agente,
      [
        p.titulo,
        ...p.perguntas.map(
          (q) =>
            `${q.pergunta}\n${q.opcoes.map((o) => `- ${o.rotulo}${o.descricao ? ': ' + o.descricao : ''}`).join('\n')}`,
        ),
      ]
        .filter(Boolean)
        .join('\n\n'),
    );
    return new Promise((resolve, reject) => {
      const terminar = (
        situacao: NonNullable<RegistroPergunta['situacao']>,
        respostas?: RespostaItem[],
      ) => {
        if (!this.resolvers.delete(p.id)) return;
        clearTimeout(timer);
        sinal.removeEventListener('abort', cancelar);
        this.pendentes.delete(p.id);
        const finalizacao = this.salvar({ ...p, situacao, respostas })
          .then(() => {
            if (respostas)
              this.historico(
                agente,
                respostas
                  .map(
                    (r) =>
                      `${p.perguntas.find((q) => q.id === r.id)!.pergunta}: ${[...r.opcoes, r.texto].filter(Boolean).join('; ')}`,
                  )
                  .join('\n'),
                true,
              );
            else
              this.historico(
                agente,
                `Pergunta ${situacao === 'expirada' ? 'expirada' : 'cancelada'}.`,
              );
            this.emitir({ tipo: 'perguntaResolvida', id: p.id, situacao });
            resolve({ situacao, respostas: respostas ?? [] });
          })
          .catch(reject);
        this.finalizacoes.add(finalizacao);
        void finalizacao.finally(() => this.finalizacoes.delete(finalizacao));
      };
      const cancelar = () => terminar('cancelada');
      const timer = setTimeout(() => terminar('expirada'), this.timeoutMs);
      this.resolvers.set(p.id, terminar);
      const { donoPid, ...publica } = p;
      this.pendentes.set(p.id, publica);
      sinal.addEventListener('abort', cancelar, { once: true });
      this.emitir({ tipo: 'pergunta', pergunta: publica });
      if (sinal.aborted) cancelar();
    });
  }
  responder(id: string, respostas: RespostaItem[]): void {
    const p = this.pendentes.get(id);
    if (!p) throw new Error('Pergunta nao encontrada neste chat.');
    if (
      respostas.length !== p.perguntas.length ||
      new Set(respostas.map((r) => r.id)).size !== respostas.length
    )
      throw new Error('Responda todas as perguntas uma unica vez.');
    for (const q of p.perguntas) {
      const r = respostas.find((r) => r.id === q.id);
      if (
        !r ||
        (!r.opcoes.length && !r.texto?.trim()) ||
        new Set(r.opcoes).size !== r.opcoes.length ||
        r.opcoes.some((o) => !q.opcoes.some((v) => v.rotulo === o)) ||
        (!q.multipla && r.opcoes.length + (r.texto?.trim() ? 1 : 0) > 1) ||
        (r.texto && (!q.permiteTexto || r.texto.length > 2000))
      )
        throw new Error('Resposta invalida para as opcoes desta pergunta.');
      if (mascarar(JSON.stringify(r)) !== JSON.stringify(r))
        throw new Error('A resposta parece conter um segredo. Remova-o antes de enviar.');
    }
    this.resolvers.get(id)!('respondida', structuredClone(respostas));
  }
  cancelar(id: string): void {
    this.resolvers.get(id)?.('cancelada');
  }
  cancelarTodas(): void {
    for (const id of this.resolvers.keys()) this.cancelar(id);
  }
  async cancelarAgente(agente: string): Promise<void> {
    for (const p of this.pendentes.values()) if (p.agente === agente) this.cancelar(p.id);
    await this.esperar();
  }
  async esperar(): Promise<void> {
    await Promise.all(this.finalizacoes);
  }
}
