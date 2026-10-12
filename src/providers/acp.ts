import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { matarArvore } from './processo';
import { mascarar } from '../core/seguranca';

export class ErroAcp extends Error {
  constructor(message: string, readonly code?: number) { super(mascarar(message)); }
}
// JSON-RPC bidirecional ACP. Nenhum stderr bruto ou credencial e enviado ao painel.
export class ClienteAcp {
  private processo: ChildProcessWithoutNullStreams;
  private proximo = 0;
  private pendentes = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer?: NodeJS.Timeout }>();
  private encerrado = false;
  private fechado: Promise<void>;
  private abortar: () => void;
  constructor(bin: { cmd: string; prefixo: string[] }, cwd: string, env: NodeJS.ProcessEnv,
    private sinal: AbortSignal,
    private notificar: (method: string, params: any) => void = () => {},
    private pedido: (method: string, params: any) => Promise<unknown> = async () => { throw new ErroAcp('Metodo ACP do cliente nao suportado.', -32601); },
  ) {
    if (sinal.aborted) throw new ErroAcp('Execucao interrompida.');
    this.processo = spawn(bin.cmd, bin.prefixo, { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    this.fechado = new Promise((r) => this.processo.once('close', () => r()));
    this.processo.stderr.resume();
    const decoder = new StringDecoder('utf8');
    let buffer = '';
    this.processo.stdout.on('data', (b) => {
      buffer += decoder.write(b);
      if (Buffer.byteLength(buffer) > 4 * 1024 * 1024) return this.fechar(new ErroAcp('Mensagem ACP excedeu 4 MB.'));
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const linha = buffer.slice(0, i); buffer = buffer.slice(i + 1);
        let j;
        try { j = JSON.parse(linha); } catch { continue; }
        if (j.jsonrpc !== '2.0') continue;
        if (typeof j.method === 'string') {
          if (j.id !== undefined) void this.responder(j);
          else { try { this.notificar(j.method, j.params); } catch (e) { this.fechar(e instanceof Error ? e : new ErroAcp('Notificacao ACP invalida.')); } }
        } else {
          const p = this.pendentes.get(j.id);
          if (!p) continue;
          this.pendentes.delete(j.id); clearTimeout(p.timer);
          j.error ? p.reject(new ErroAcp(j.error.message ?? 'Agente ACP recusou a solicitacao.', j.error.code)) : p.resolve(j.result);
        }
      }
    });
    this.processo.on('error', () => this.fechar(new ErroAcp('Nao foi possivel iniciar o agente ACP.')));
    this.processo.on('close', () => this.fechar(new ErroAcp('Agente ACP encerrou a conexao.')));
    this.processo.stdin.on('error', () => this.fechar(new ErroAcp('Agente ACP encerrou a entrada.')));
    this.abortar = () => this.fechar(new ErroAcp('Execucao interrompida.'));
    sinal.addEventListener('abort', this.abortar, { once: true });
  }
  private enviar(v: unknown) { if (!this.encerrado) this.processo.stdin.write(JSON.stringify(v) + '\n'); }
  private async responder(j: any) {
    try { this.enviar({ jsonrpc: '2.0', id: j.id, result: await this.pedido(j.method, j.params) }); }
    catch (e) { this.enviar({ jsonrpc: '2.0', id: j.id, error: { code: e instanceof ErroAcp ? e.code ?? -32603 : -32603, message: 'Solicitacao do agente recusada pelo Orquestrador.' } }); }
  }
  request(method: string, params: unknown, timeoutMs = 15000): Promise<any> {
    if (this.encerrado) return Promise.reject(new ErroAcp('Conexao ACP encerrada.'));
    return new Promise((resolve, reject) => {
      const id = ++this.proximo;
      const timer = timeoutMs ? setTimeout(() => { this.pendentes.delete(id); reject(new ErroAcp(`ACP: ${method} excedeu o tempo limite.`)); }, timeoutMs) : undefined;
      this.pendentes.set(id, { resolve, reject, timer });
      this.enviar({ jsonrpc: '2.0', id, method, params });
    });
  }
  async inicializar() {
    const r = await this.request('initialize', { protocolVersion: 1,
      clientInfo: { name: 'fagulha_orquestrador', title: 'Orquestrador Fagulha', version: '0.4.5' },
      clientCapabilities: { _meta: { 'browser-auth-delegated': true } },
    });
    if (r?.protocolVersion !== 1) throw new ErroAcp('Versao ACP nao suportada.');
    return r;
  }
  async fechar(e: Error = new ErroAcp('Conexao ACP encerrada.')) {
    if (this.encerrado) return this.fechado;
    this.encerrado = true;
    this.sinal.removeEventListener('abort', this.abortar);
    for (const p of this.pendentes.values()) { clearTimeout(p.timer); p.reject(e); }
    this.pendentes.clear();
    this.processo.stdin.end();
    matarArvore(this.processo.pid);
    await this.fechado;
  }
}
