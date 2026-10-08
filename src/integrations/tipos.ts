import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Integracao, DoHost } from '../shared/protocolo';
export type FerramentaIntegracao = Tool;
export interface ItemCatalogo {
  id: string;
  nome: string;
  descricao: string;
  url?: string;
  fallbackSse?: string;
  autenticacao: ('token' | 'oauth' | 'oauth_cliente_proprio' | 'nenhuma')[];
  escopos: string[];
  requisitos: string[];
  documentacao: string;
  fase: 'a' | 'b';
  preview?: boolean;
}
export interface RegistroIntegracao {
  id: string;
  nome: string;
  personalizada: boolean;
  transporte: 'http' | 'sse' | 'stdio';
  url?: string;
  comando?: string;
  args?: string[];
  autenticacao: 'token' | 'nenhuma';
  ativa: boolean;
  conectada?: boolean;
  revisao?: string;
  somenteLeitura?: boolean;
}
export type EstadoIntegracao = Integracao;
export type EventoIntegracao = Extract<DoHost, { tipo: 'integracoes' | 'integracao' }>;
export interface ConexaoMcp {
  listar(sinal?: AbortSignal): Promise<Tool[]>;
  chamar(nome: string, args: Record<string, unknown>, sinal?: AbortSignal): Promise<CallToolResult>;
  fechar(): Promise<void>;
}
export interface ResultadoIntegracao {
  conteudoMcp: CallToolResult['content'];
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}
