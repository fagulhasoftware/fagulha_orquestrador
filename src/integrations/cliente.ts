import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { RegistroIntegracao, ConexaoMcp } from './tipos';
import { ErroFerramenta } from '../mcp/erros';
export async function conectarMcp(
  r: RegistroIntegracao,
  token?: string,
  timeoutMs = 15000,
): Promise<ConexaoMcp> {
  const cliente = new Client(
    { name: 'fagulha_integracoes', version: '0.4.0' },
    { capabilities: {} },
  );
  const fetchSeguro: typeof fetch = async (input, init) => {
    const destino = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    if (r.url && destino.origin !== new URL(r.url).origin)
      throw new ErroFerramenta('Servidor MCP tentou acessar outro dominio.');
    const headers = new Headers(init?.headers);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const controle = new AbortController();
    const timer = setTimeout(() => controle.abort(), timeoutMs);
    try {
      return await fetch(input, {
        ...init,
        headers,
        redirect: 'error',
        signal: AbortSignal.any([controle.signal, ...(init?.signal ? [init.signal] : [])]),
      });
    } finally {
      clearTimeout(timer);
    }
  };
  let transporte: Transport;
  if (r.transporte === 'stdio')
    transporte = new StdioClientTransport({
      command: r.comando!,
      args: r.args ?? [],
      stderr: 'ignore',
    });
  else {
    const requestInit = token ? { headers: { Authorization: `Bearer ${token}` } } : {};
    transporte =
      r.transporte === 'sse'
        ? new SSEClientTransport(new URL(r.url!), {
            requestInit,
            fetch: fetchSeguro,
            eventSourceInit: { fetch: fetchSeguro },
          })
        : new StreamableHTTPClientTransport(new URL(r.url!), {
            requestInit,
            fetch: fetchSeguro,
            reconnectionOptions: {
              maxRetries: 0,
              initialReconnectionDelay: 1000,
              maxReconnectionDelay: 1000,
              reconnectionDelayGrowFactor: 1,
            },
          });
  }
  try {
    await cliente.connect(transporte, { timeout: timeoutMs });
  } catch (e) {
    await cliente.close().catch(() => {});
    const code = (e as { code?: number }).code;
    throw new ErroFerramenta(
      code === 401 || code === 403 || (e as Error).name === 'UnauthorizedError'
        ? 'Autenticacao recusada pelo servidor MCP.'
        : 'Nao foi possivel conectar ao servidor MCP (endpoint, transporte ou tempo limite).',
    );
  }
  return {
    async listar(sinal) {
      const ferramentas = [];
      let cursor: string | undefined;
      const vistos = new Set<string>();
      do {
        const pagina = await cliente.listTools(cursor ? { cursor } : {}, {
          timeout: timeoutMs,
          signal: sinal,
        });
        ferramentas.push(...pagina.tools);
        if (ferramentas.length > 512)
          throw new ErroFerramenta('Servidor excede o limite de 512 ferramentas.');
        cursor = pagina.nextCursor;
        if (cursor && vistos.has(cursor)) throw new ErroFerramenta('Paginacao MCP invalida.');
        if (cursor) vistos.add(cursor);
      } while (cursor);
      return ferramentas;
    },
    async chamar(nome, args, sinal) {
      return (await cliente.callTool({ name: nome, arguments: args }, undefined, {
        timeout: timeoutMs,
        signal: sinal,
      })) as import('@modelcontextprotocol/sdk/types.js').CallToolResult;
    },
    async fechar() {
      await cliente.close();
    },
  };
}
