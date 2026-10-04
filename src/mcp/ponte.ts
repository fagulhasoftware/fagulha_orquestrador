import { createServer, type Server } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { validarArgumentos } from './ferramentas';
export interface Capacidade {
  agente: string;
  sinal: AbortSignal;
}
export class PonteHttp {
  private servidor?: Server;
  private capacidades = new Map<string, Capacidade>();
  url = '';
  constructor(
    private chamar: (
      agente: string,
      nome: string,
      args: Record<string, unknown>,
      sinal: AbortSignal,
    ) => Promise<unknown>,
  ) {}
  async iniciar(): Promise<void> {
    this.servidor = createServer(async (req, res) => {
      res.setHeader('content-type', 'application/json');
      res.setHeader('cache-control', 'no-store');
      const responder = (status: number, dados: unknown) => {
        if (!res.writableEnded) {
          res.writeHead(status);
          res.end(JSON.stringify(dados));
        }
      };
      if (req.method !== 'POST' || req.url !== '/ferramenta' || req.headers.origin) {
        responder(403, { erro: 'Requisicao recusada.' });
        return;
      }
      const recebido = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
      const capacidade = [...this.capacidades].find(
        ([token]) =>
          Buffer.byteLength(token) === Buffer.byteLength(recebido) &&
          timingSafeEqual(Buffer.from(token), Buffer.from(recebido)),
      )?.[1];
      if (!capacidade || capacidade.sinal.aborted) {
        responder(401, { erro: 'Nao autorizado.' });
        return;
      }
      const desconectado = new AbortController();
      res.on('close', () => {
        if (!res.writableEnded) desconectado.abort();
      });
      const timer = setTimeout(() => {
        desconectado.abort();
        responder(408, { erro: 'Timeout.' });
      }, 180_000);
      try {
        let bytes = 0;
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > 2_100_000) {
            responder(413, { erro: 'Corpo excede limite.' });
            req.destroy();
            return;
          }
          chunks.push(chunk);
        }
        const pedido = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const args = validarArgumentos(pedido.nome, pedido.args);
        const sinal = AbortSignal.any([capacidade.sinal, desconectado.signal]);
        const resultado = await this.chamar(capacidade.agente, pedido.nome, args, sinal);
        responder(200, { resultado });
      } catch {
        responder(400, { erro: 'Ferramenta falhou, foi negada ou recebeu argumentos invalidos.' });
      } finally {
        clearTimeout(timer);
      }
    });
    this.servidor.requestTimeout = 180_000;
    this.servidor.headersTimeout = 5000;
    await new Promise<void>((resolve, reject) => {
      this.servidor!.once('error', reject);
      this.servidor!.listen(0, '127.0.0.1', () => resolve());
    });
    const endereco = this.servidor.address();
    if (!endereco || typeof endereco === 'string') throw new Error('Ponte indisponivel.');
    this.url = `http://127.0.0.1:${endereco.port}/ferramenta`;
  }
  criar(agente: string, sinal: AbortSignal): { url: string; token: string; revogar: () => void } {
    const token = randomBytes(32).toString('hex');
    this.capacidades.set(token, { agente, sinal });
    const revogar = () => this.capacidades.delete(token);
    sinal.addEventListener('abort', revogar, { once: true });
    return {
      url: this.url,
      token,
      revogar: () => {
        sinal.removeEventListener('abort', revogar);
        revogar();
      },
    };
  }
  async finalizar(): Promise<void> {
    this.capacidades.clear();
    this.servidor?.closeAllConnections();
    await new Promise<void>((r) => (this.servidor ? this.servidor.close(() => r()) : r()));
  }
}
