import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { ferramentas } from './ferramentas';
import { chamarPonte, FalhaPonte } from './cliente-ponte';
import { diagnosticos } from './diagnostico';
const servidor = new Server(
  { name: 'fagulha_orquestrador', version: '0.2.2' },
  { capabilities: { tools: {} } },
);
servidor.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: ferramentas }));
servidor.setRequestHandler(CallToolRequestSchema, async (pedido) => {
  try {
    const resultado = await chamarPonte(pedido.params.name, pedido.params.arguments ?? {});
    return { content: [{ type: 'text' as const, text: JSON.stringify(resultado) }] };
  } catch (e) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: e instanceof FalhaPonte ? e.message : diagnosticos.ferramenta_falhou,
        },
      ],
    };
  }
});
void servidor.connect(new StdioServerTransport()).catch(() => {
  process.exitCode = 1;
});
