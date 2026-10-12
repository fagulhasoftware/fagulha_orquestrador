import { createServer, type Server } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Socket } from 'node:net';
import { auth, extractWWWAuthenticateParams, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthTokens,
  OAuthClientInformationMixed,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { Segredos } from '../providers/tipos';
import { protegerSegredo } from '../core/seguranca';

export class OAuthMcp implements OAuthClientProvider {
  redirectUrl = '';
  private servidor?: Server;
  private sockets = new Set<Socket>();
  private codigo?: Promise<string>;
  private resolver?: (codigo: string) => void;
  private rejeitar?: (e: Error) => void;
  private timer?: ReturnType<typeof setTimeout>;
  private verifier = '';
  private estado = randomBytes(32).toString('hex');
  constructor(
    private id: string,
    private cofre: Segredos,
    private abrir: (url: string) => Promise<void>,
    private cliente?: { clientId: string; clientSecret?: string; issuer?: string },
    private registroDinamico = true,
  ) {}
  get clientMetadata() {
    return {
      client_name: 'Orquestrador Fagulha',
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: this.cliente?.clientSecret ? 'client_secret_basic' : 'none',
    };
  }
  state() {
    return this.estado;
  }
  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    if (this.cliente)
      return {
        client_id: this.cliente.clientId,
        client_secret: this.cliente.clientSecret,
        ...(this.cliente.issuer ? { issuer: this.cliente.issuer } : {}),
      };
    const s = await this.cofre.get(`fagulha.integracao.${this.id}.oauth.client`);
    return s ? JSON.parse(s) : undefined;
  }
  async saveClientInformation(v: OAuthClientInformationMixed) {
    if ('client_secret' in v && typeof v.client_secret === 'string')
      protegerSegredo(v.client_secret);
    await this.cofre.store(`fagulha.integracao.${this.id}.oauth.client`, JSON.stringify(v));
  }
  async tokens(): Promise<OAuthTokens | undefined> {
    const s = await this.cofre.get(`fagulha.integracao.${this.id}.oauth.tokens`);
    return s ? JSON.parse(s) : undefined;
  }
  async saveTokens(v: OAuthTokens) {
    protegerSegredo(v.access_token);
    if (v.refresh_token) protegerSegredo(v.refresh_token);
    await this.cofre.store(`fagulha.integracao.${this.id}.oauth.tokens`, JSON.stringify(v));
  }
  saveCodeVerifier(v: string) {
    this.verifier = v;
    protegerSegredo(v);
  }
  codeVerifier() {
    return this.verifier;
  }
  async redirectToAuthorization(url: URL) {
    if (!this.servidor)
      throw new Error('Reconecte a integracao pelo painel para renovar a autorizacao.');
    if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(url.hostname))
      throw new Error('Autorizacao OAuth exige HTTPS.');
    await this.abrir(url.href);
  }
  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
    if (scope === 'all' || scope === 'tokens')
      await this.cofre.delete?.(`fagulha.integracao.${this.id}.oauth.tokens`);
    if (scope === 'all' || scope === 'client')
      await this.cofre.delete?.(`fagulha.integracao.${this.id}.oauth.client`);
    if (scope === 'all' || scope === 'verifier') this.verifier = '';
  }
  async iniciar(porta = 43219) {
    this.codigo = new Promise<string>((resolve, reject) => {
      this.resolver = resolve;
      this.rejeitar = reject;
    });
    // Handler anexado antes do callback para rejeicoes por timeout nao ficarem sem consumidor.
    void this.codigo.catch(() => {});
    this.servidor = createServer((req, res) => {
      const u = new URL(req.url ?? '/', this.redirectUrl || 'http://127.0.0.1');
      const estado = u.searchParams.get('state') ?? '';
      if (
        req.method !== 'GET' ||
        u.pathname !== '/oauth/callback' ||
        req.headers.origin ||
        Buffer.byteLength(estado) !== Buffer.byteLength(this.estado) ||
        !timingSafeEqual(Buffer.from(estado), Buffer.from(this.estado))
      ) {
        res.writeHead(400);
        res.end('Callback invalido.');
        return;
      }
      if (u.searchParams.has('error')) {
        res.writeHead(400);
        res.end('Autorizacao recusada.');
        this.rejeitar?.(new Error('Autorizacao recusada pelo usuario.'));
        return;
      }
      const code = u.searchParams.get('code');
      if (!code || code.length > 8192) {
        res.writeHead(400);
        res.end('Codigo ausente.');
        return;
      }
      protegerSegredo(code);
      res.setHeader('Cache-Control', 'no-store');
      res.end('Autorizacao recebida. Volte para a sala Fagulha para acompanhar a validacao da conexao.');
      this.resolver?.(code);
    });
    // Chrome pode abrir sockets de preconexao sem enviar uma requisicao.
    // server.close aguarda esses sockets indefinidamente no extension host.
    this.servidor.on('connection', (socket) => {
      this.sockets.add(socket);
      socket.once('close', () => this.sockets.delete(socket));
    });
    await new Promise<void>((resolve, reject) => {
      this.servidor!.once('error', reject);
      this.servidor!.listen(porta, '127.0.0.1', () => resolve());
    });
    this.redirectUrl = `http://127.0.0.1:${(this.servidor.address() as { port: number }).port}/oauth/callback`;
    this.timer = setTimeout(
      () => this.rejeitar?.(new Error('Autorizacao expirou em 5 minutos.')),
      300000,
    );
  }
  async autorizar(serverUrl: string) {
    // Um registro DCR sem tokens pode ter expirado ou ter sido removido pelo
    // fornecedor. Nao reutilize esse cliente numa nova tentativa interativa.
    // Clientes cadastrados pelo usuario devem ser preservados.
    if (this.registroDinamico && !this.cliente && !(await this.tokens()))
      await this.invalidateCredentials('client');
    const fetchFn: typeof fetch = async (input, init) => {
      const u = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      );
      if (u.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))
        throw new Error('OAuth exige HTTPS.');
      return fetch(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(15000) });
    };
    // Use o desafio do MCP: alguns servidores anunciam metadados fora da URL padrao.
    const desafio = await fetchFn(serverUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
        protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'fagulha_integracoes', version: '0.4.2' },
      } }),
    });
    const params = extractWWWAuthenticateParams(desafio);
    await desafio.body?.cancel();
    const opcoes = { serverUrl, fetchFn, resourceMetadataUrl: params.resourceMetadataUrl, scope: params.scope };
    const r = await auth(this, opcoes);
    if (r === 'REDIRECT') {
      const code = await this.codigo!;
      if ((await auth(this, { ...opcoes, authorizationCode: code })) !== 'AUTHORIZED')
        throw new Error('OAuth nao concluido.');
    }
  }
  async fechar() {
    if (this.timer) clearTimeout(this.timer);
    this.rejeitar?.(new Error('Autorizacao encerrada.'));
    if (this.servidor) {
      const encerramento = new Promise<void>((r) => this.servidor!.close(() => r()));
      for (const socket of this.sockets) socket.destroy();
      this.sockets.clear();
      await encerramento;
    }
    this.servidor = undefined;
    this.verifier = '';
  }
}
