import type { Agente, ModoAgente, NivelPermissao, EstadoLogin } from '../shared/protocolo';
import type { ConfigLogin } from './login';
export interface Deteccao {
  instalado: boolean;
  versao?: string;
  caminho?: string;
}
export interface PonteSessao {
  url: string;
  token: string;
  servidor: string;
  diretorio: string;
}
export interface PedidoExecucao {
  prompt: string;
  projeto: string;
  modo: ModoAgente;
  nivel: NivelPermissao;
  sessao?: string;
  ponte: PonteSessao;
  imagens?: { mime: string; base64: string }[];
  caminhosImagens?: string[];
  ferramenta?: (nome: string, args: Record<string, unknown>) => Promise<unknown>;
}
export interface EventosProvedor {
  fase?(tipo: import('../shared/protocolo').TipoFase, detalhe?: string): void;
  sessao(id: string): void;
  fala(texto: string): void;
  parcial(texto: string): void;
  acao(texto: string): void;
  sistema?(texto: string): void;
  erro(texto: string): void;
}
export interface Provedor {
  agente: Agente;
  autenticacao?: ConfigLogin;
  detectar(): Promise<Deteccao>;
  estadoLogin(sinal?: AbortSignal): Promise<EstadoLogin>;
  login(): Promise<void>;
  executar(pedido: PedidoExecucao, eventos: EventosProvedor, sinal: AbortSignal): Promise<void>;
}
export interface Segredos {
  get(id: string): PromiseLike<string | undefined>;
  store(id: string, valor: string): PromiseLike<void>;
  delete?(id: string): PromiseLike<void>;
}
export function agentePadrao(
  id: string,
  nick: string,
  tipo: 'cli' | 'api',
  cor: string,
  apelidos: string[] = [],
): Agente {
  return {
    id,
    nick,
    tipo,
    cor,
    apelidos,
    origem: 'embutido',
    instalado: false,
    login: 'desconhecido',
    opcoesLogin: [],
    habilitado: false,
    papel: 'Colabore com os participantes e cumpra a missao recebida.',
    modo: 'leitura_escrita',
    estado: 'desabilitado',
    suportaImagem: tipo === 'api',
    temSessao: false,
  };
}
