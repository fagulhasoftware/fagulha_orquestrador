/** Cancellation is a request, not a guarantee that a provider promise settles. */
export function aguardarCancelamento<T>(
  tarefa: Promise<T>, sinal: AbortSignal, prazoMs: number,
  pendente: (tarefa: Promise<T>) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let terminou = false;
    const limpar = () => { if (timer) clearTimeout(timer); sinal.removeEventListener('abort', cancelar); };
    const cancelar = () => {
      if (terminou || timer) return;
      timer = setTimeout(() => {
        if (terminou) return;
        terminou = true;
        limpar();
        pendente(tarefa);
        reject(new Error('Cancelamento sem confirmacao de encerramento; fila liberada e agente isolado.'));
      }, prazoMs);
    };
    sinal.addEventListener('abort', cancelar, { once: true });
    if (sinal.aborted) cancelar();
    tarefa.then((valor) => {
      if (terminou) return;
      terminou = true; limpar(); resolve(valor);
    }, (erro) => {
      if (terminou) return;
      terminou = true; limpar(); reject(erro);
    });
  });
}

export function aguardarPrazo<T>(tarefa: Promise<T>, prazoMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Prazo de finalizacao excedido.')), prazoMs);
    tarefa.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}
