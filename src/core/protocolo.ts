import { z } from 'zod';
import type { DoWebview } from '../shared/protocolo';
const texto = z.string().max(100_000);
const id = z.string().min(1).max(200);
const vazio = (tipo: string) => z.object({ tipo: z.literal(tipo) }).strict();
const modo = z.enum(['leitura', 'escrita', 'leitura_escrita']);
const schemas = [
  ...[
    'pronto',
    'parar',
    'anexarArquivos',
    'importarContexto',
    'instalarAgente',
    'concluirAssistente',
    'vozIniciar',
    'vozParar',
    'vozDescartar',
    'vozCancelarInstalacao',
    'pararLeitura',
    'exportarConversa',
    'novoChat',
    'listarMemorias',
  ].map(vazio),
  z.object({ tipo: z.literal('listarChats'), busca: z.string().max(500).optional() }).strict(),
  ...['abrirChat', 'excluirChat', 'exportarChat', 'excluirMemoria'].map((tipo) =>
    z.object({ tipo: z.literal(tipo), id }).strict(),
  ),
  z
    .object({ tipo: z.literal('renomearChat'), id, titulo: z.string().trim().min(1).max(120) })
    .strict(),
  z.object({ tipo: z.literal('fixarChat'), id, fixado: z.boolean() }).strict(),
  z
    .object({
      tipo: z.literal('salvarMemoria'),
      id: id.optional(),
      escopo: z.enum(['global', 'projeto']),
      texto: z.string().min(1).max(500),
      ativa: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      tipo: z.literal('vozInstalar'),
      componentes: z
        .array(z.enum(['ffmpeg', 'whisper', 'modelo']))
        .min(1)
        .max(3),
    })
    .strict(),
  z
    .object({
      tipo: z.literal('vozConfigurar'),
      dispositivo: z.string().max(500).optional(),
      modelo: z.enum(['base', 'small', 'medium']).optional(),
      idioma: z.enum(['pt', 'en', 'es', 'auto']).optional(),
      envioAutomatico: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      tipo: z.literal('leituraConfigurar'),
      ativa: z.boolean().optional(),
      voz: z.string().max(200).optional(),
      velocidade: z.number().min(0.5).max(2).optional(),
    })
    .strict(),
  z.object({ tipo: z.literal('lerMensagem'), id }).strict(),
  z.object({ tipo: z.literal('enviar'), texto, anexos: z.array(id).max(20) }).strict(),
  z.object({ tipo: z.literal('carregarAnteriores'), antesDe: id }).strict(),
  z
    .object({
      tipo: z.literal('anexarDados'),
      nome: z.string().max(255),
      mime: z.string().max(200),
      base64: z
        .string()
        .max(28_000_000)
        .regex(/^[A-Za-z0-9+/]*={0,2}$/),
    })
    .strict(),
  z
    .object({
      tipo: z.literal('anexarCaminhos'),
      uris: z.array(z.string().min(1).max(8192)).min(1).max(20),
    })
    .strict(),
  ...['removerAnexo', 'removerContexto', 'loginCancelar', 'logout', 'agenteNovaSessao'].map(
    (tipo) => z.object({ tipo: z.literal(tipo), id }).strict(),
  ),
  z
    .object({
      tipo: z.literal('loginIniciar'),
      id,
      metodo: z.enum(['navegador', 'dispositivo', 'chave']),
      variante: z.string().max(80).optional(),
    })
    .strict(),
  z
    .object({
      tipo: z.literal('loginChave'),
      id,
      chave: z.string().max(4096),
      baseUrl: z.string().max(2048).optional(),
    })
    .strict(),
  z.object({ tipo: z.literal('abrirLinkLogin'), url: z.string().url().max(16_384) }).strict(),
  z
    .object({
      tipo: z.literal('responderAprovacao'),
      id,
      decisao: z.enum(['aprovar', 'aprovar_sessao', 'negar']),
    })
    .strict(),
  z.object({ tipo: z.literal('agenteHabilitar'), id, habilitado: z.boolean() }).strict(),
  z.object({ tipo: z.literal('agenteModo'), id, modo }).strict(),
  z.object({ tipo: z.literal('agenteConfigurar'), id }).strict(),
  z.object({ tipo: z.literal('agentePapel'), id, papel: texto }).strict(),
  z
    .object({
      tipo: z.literal('configurar'),
      parcial: z
        .object({
          nick: z.string().min(1).max(80).optional(),
          topico: texto.optional(),
          passagensAutomaticas: z.number().int().min(0).max(30).optional(),
          timeoutMinutos: z.number().min(1).max(120).optional(),
          limites: z
            .object({
              textoIntegralKB: z.number().positive(),
              textoMaxMB: z.number().positive(),
              imagemMaxMB: z.number().positive(),
              documentoMaxMB: z.number().positive(),
              planilhaMaxMB: z.number().positive(),
              planilhaLinhasPorAba: z.number().positive(),
              planilhaAbas: z.number().positive(),
            })
            .strict()
            .optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      tipo: z.literal('definirNivel'),
      nivel: z.enum(['manual', 'parcial', 'total']),
      confirmacao: z.string().max(100).optional(),
    })
    .strict(),
  z.object({ tipo: z.literal('abrirLink'), url: z.string().url().max(2048) }).strict(),
];
export function validarMensagem(valor: unknown): DoWebview {
  for (const schema of schemas) {
    const r = schema.safeParse(valor);
    if (r.success) return r.data as DoWebview;
  }
  throw new Error('Mensagem do webview invalida ou versao incompatível.');
}
