import { esquemaPergunta } from '../core/perguntas';
export const ferramentas = [
  {
    name: 'perguntar_usuario',
    description:
      'Perguntar ao usuario com opcoes sugeridas e aguardar sua resposta na sala. Nao e uma aprovacao de acao.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        titulo: { type: 'string', maxLength: 500 },
        perguntas: {
          type: 'array',
          minItems: 1,
          maxItems: 4,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'pergunta', 'opcoes'],
            properties: {
              id: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,80}$' },
              pergunta: { type: 'string', minLength: 1, maxLength: 500 },
              multipla: { type: 'boolean' },
              permiteTexto: { type: 'boolean' },
              opcoes: {
                type: 'array',
                minItems: 2,
                maxItems: 6,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['rotulo'],
                  properties: {
                    rotulo: { type: 'string', minLength: 1, maxLength: 500 },
                    descricao: { type: 'string', maxLength: 500 },
                    recomendada: { type: 'boolean' },
                  },
                },
              },
            },
          },
        },
      },
      required: ['perguntas'],
    },
  },
  {
    name: 'memoria_propor',
    description:
      'Propor fato duravel ou preferencia. Total salva automaticamente; outros niveis pedem aprovacao individual. Nunca envie segredos.',
    inputSchema: {
      type: 'object',
      properties: {
        texto: { type: 'string', maxLength: 500 },
        escopo: { type: 'string', enum: ['global', 'projeto'] },
      },
      required: ['texto', 'escopo'],
      additionalProperties: false,
    },
  },
  {
    name: 'aprovar',
    description:
      'Portao de permissao. Ferramentas nativas sao recusadas; use as ferramentas do Orquestrador Fagulha.',
    inputSchema: {
      type: 'object',
      properties: { tool_name: { type: 'string' }, input: { type: 'object' } },
      required: ['tool_name'],
      additionalProperties: false,
    },
  },
  {
    name: 'sala_publicar',
    description: 'Publicar mensagem compartilhada na sala.',
    inputSchema: {
      type: 'object',
      properties: { texto: { type: 'string', maxLength: 100000 } },
      required: ['texto'],
      additionalProperties: false,
    },
  },
  {
    name: 'sala_ler',
    description: 'Ler as ultimas mensagens da sala.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'anexos_listar',
    description: 'Listar metadados dos anexos enviados nesta sala.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'anexo_ler',
    description: 'Ler texto ou amostra de um anexo enviado.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'arquivo_ler',
    description: 'Ler arquivo de texto pelo Portao; arquivos protegidos sao recusados.',
    inputSchema: {
      type: 'object',
      properties: { caminho: { type: 'string' } },
      required: ['caminho'],
      additionalProperties: false,
    },
  },
  {
    name: 'arquivo_escrever',
    description: 'Escrever arquivo pelo Portao. Sobrescrita pede aprovacao fora do Total.',
    inputSchema: {
      type: 'object',
      properties: { caminho: { type: 'string' }, texto: { type: 'string', maxLength: 2000000 } },
      required: ['caminho', 'texto'],
      additionalProperties: false,
    },
  },
  {
    name: 'comando_executar',
    description:
      'Executar shell com timeout e limite de saida. No Total, somente comandos irreversiveis externos conhecidos pedem confirmacao.',
    inputSchema: {
      type: 'object',
      properties: { comando: { type: 'string', maxLength: 4000 } },
      required: ['comando'],
      additionalProperties: false,
    },
  },
  {
    name: 'navegador_ler',
    description: 'Ler pagina HTTP(S), no maximo 1 MB.',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
      additionalProperties: false,
    },
  },
  {
    name: 'navegador_abrir',
    description: 'Abrir URL no navegador externo mediante Portao.',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
      additionalProperties: false,
    },
  },
] as const;
export type NomeFerramenta = (typeof ferramentas)[number]['name'];
export function validarArgumentos(nome: string, entrada: unknown): Record<string, unknown> {
  if (nome === 'perguntar_usuario') return esquemaPergunta.parse(entrada);
  const ferramenta = ferramentas.find((f) => f.name === nome);
  if (!ferramenta || !entrada || typeof entrada !== 'object' || Array.isArray(entrada))
    throw new Error('Ferramenta ou argumentos invalidos.');
  const args = entrada as Record<string, unknown>;
  const schema = ferramenta.inputSchema as {
    properties: Record<string, { type: string; maxLength?: number; enum?: readonly string[] }>;
    required?: readonly string[];
  };
  for (const chave of Object.keys(args))
    if (!schema.properties[chave]) throw new Error('Argumento desconhecido.');
  for (const chave of schema.required ?? [])
    if (!(chave in args)) throw new Error(`Argumento obrigatorio: ${chave}`);
  for (const [chave, valor] of Object.entries(args)) {
    const p = schema.properties[chave];
    if (
      typeof valor !== p.type ||
      (typeof valor === 'string' && valor.length > (p.maxLength ?? 10000)) ||
      (p.enum && !p.enum.includes(String(valor)))
    )
      throw new Error(`Argumento invalido: ${chave}`);
  }
  return args;
}
