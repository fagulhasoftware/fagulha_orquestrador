import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { ferramentas, validarArgumentos } from './ferramentas';
const servidor = new Server(
  { name: 'fagulha_orquestrador', version: '0.1.0' },
  { capabilities: { tools: {} } },
);
servidor.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: ferramentas }));
servidor.setRequestHandler(CallToolRequestSchema, async (pedido) => {
  try {
    const args = validarArgumentos(pedido.params.name, pedido.params.arguments ?? {});
    const url = process.env.ORQUESTRA_BRIDGE_URL,
      token = process.env.ORQUESTRA_BRIDGE_TOKEN;
    if (!url || !token || new URL(url).hostname !== '127.0.0.1')
      throw new Error('Ponte indisponivel.');
    const resposta = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ nome: pedido.params.name, args }),
      signal: AbortSignal.timeout(180_000),
      redirect: 'error',
    });
    if (!resposta.ok) throw new Error('Acao negada ou ponte indisponivel.');
    const r = (await resposta.json()) as { resultado: unknown };
    return { content: [{ type: 'text' as const, text: JSON.stringify(r.resultado) }] };
  } catch {
    return {
      isError: true,
      content: [
        { type: 'text' as const, text: 'Acao negada, argumentos invalidos ou ponte indisponivel.' },
      ],
    };
  }
});
void servidor.connect(new StdioServerTransport()).catch(() => {
  process.exitCode = 1;
});
