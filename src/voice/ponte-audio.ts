import { randomUUID } from 'node:crypto';
import type { DoHost, PacoteAudioVoz } from '../shared/protocolo';
export interface TelaAudio {
  postMessage(m: DoHost): PromiseLike<unknown>;
}
export class PonteAudio {
  private pendentes = new Map<string, { tela: TelaAudio; concluir: (erro?: Error) => void }>();
  constructor(
    private tela: () => TelaAudio | undefined,
    private timeoutMs = 180000,
  ) {}
  reproduzir(p: Omit<PacoteAudioVoz, 'id'>, sinal: AbortSignal): Promise<void> {
    if (sinal.aborted) return Promise.reject(Error('Leitura cancelada.'));
    const tela = this.tela();
    if (!tela) return Promise.reject(Error('Abra o painel da sala para ouvir.'));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const terminar = (erro?: Error) => {
        clearTimeout(timer);
        sinal.removeEventListener('abort', cancelar);
        this.pendentes.delete(id);
        if (erro) reject(erro);
        else resolve();
      };
      const cancelar = () => {
        void tela.postMessage({ tipo: 'vozPararAudio', id });
        terminar(Error('Leitura cancelada.'));
      };
      const timer = setTimeout(() => {
        void tela.postMessage({ tipo: 'vozPararAudio', id });
        terminar(Error('Reproducao de voz excedeu o tempo limite.'));
      }, this.timeoutMs);
      this.pendentes.set(id, { tela, concluir: terminar });
      sinal.addEventListener('abort', cancelar, { once: true });
      Promise.resolve(tela.postMessage({ tipo: 'vozReproduzir', audio: { ...p, id } }))
        .then((ok) => {
          if (ok === false) terminar(Error('Painel de voz fechado.'));
        })
        .catch(() => terminar(Error('Painel de voz indisponivel.')));
    });
  }
  responder(tela: TelaAudio, id: string, estado: 'concluido' | 'erro' | 'cancelado'): void {
    const p = this.pendentes.get(id);
    if (p?.tela === tela)
      p.concluir(
        estado === 'concluido'
          ? undefined
          : Error(
              estado === 'cancelado'
                ? 'Leitura cancelada.'
                : 'Webview nao conseguiu reproduzir o audio.',
            ),
      );
  }
  fechar(tela?: TelaAudio): void {
    for (const p of [...this.pendentes.values()])
      if (!tela || p.tela === tela) p.concluir(Error('Painel de voz fechado.'));
  }
}
