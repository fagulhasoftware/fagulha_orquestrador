// Contrato entre o webview (interface de chat) e o extension host.
// Alteracoes afetam a interface e a extensao: descreva o impacto no pull request (ver CONTRIBUTING.md).
// Regra: o webview nunca recebe segredos nem caminhos de arquivos de credenciais.

export const VERSAO_PROTOCOLO = 2; // v2: fluxo de login sem terminal (2026-10-04)

// ---------- dominio ----------

export type NivelPermissao = 'manual' | 'parcial' | 'total';
export type ModoAgente = 'leitura_escrita' | 'leitura' | 'escrita';
export type TipoProvedor = 'cli' | 'api';
export type EstadoLogin = 'conectado' | 'desconectado' | 'chave_configurada' | 'desconhecido';
export type EstadoAgente = 'livre' | 'na_fila' | 'trabalhando' | 'desabilitado' | 'erro';

// ---------- login (v2) ----------
// Nenhum login abre terminal. CLIs: o host roda o comando oficial de login em segundo plano,
// abre o link no navegador do sistema e acompanha o status ate concluir. Chaves de API: o usuario
// obtem a chave no console do provedor (link externo), cola no formulario e o host so a grava no
// SecretStorage depois de valida-la com uma chamada autenticada gratuita ao provedor.
export type MetodoLogin =
  | 'navegador'          // CLI abre o navegador e recebe o retorno sozinho (claude auth login, codex login)
  | 'dispositivo'        // link + codigo exibidos na interface (codex login --device-auth)
  | 'chave';             // chave de API colada, validada antes de gravar

export interface OpcaoLogin {
  metodo: MetodoLogin;
  rotulo: string;        // ex.: 'Assinatura Claude', 'Anthropic Console', 'Conta ChatGPT', 'Chave de API'
  variante?: string;     // repassado ao host, ex.: 'claudeai' | 'console'
  linkChave?: string;    // metodo 'chave': pagina oficial onde o usuario cria a chave
  ajuda?: string;        // uma frase sobre cobranca ou requisitos
}

export type EtapaLogin =
  | 'iniciando'
  | 'aguardando_navegador' // link aberto; aguardando o usuario concluir no navegador
  | 'codigo_dispositivo'   // exibir url + codigo
  | 'validando'            // chave recebida; testando com o provedor
  | 'conectado'
  | 'erro'
  | 'cancelado';

export interface ProgressoLogin {
  agente: string;
  etapa: EtapaLogin;
  url?: string;          // link para abrir/reabrir manualmente
  codigo?: string;       // codigo de dispositivo (nao e segredo de longo prazo)
  conta?: string;        // identificacao mascarada: e-mail, plano ou 'chave ...a1b2'
  mensagem?: string;     // explicacao em portugues para erro ou etapa
}


export type CategoriaAcao =
  | 'leitura_workspace' | 'escrita_workspace'
  | 'leitura_maquina' | 'escrita_maquina'
  | 'comando' | 'rede_leitura' | 'navegador' | 'externo'
  | 'publicacao' | 'credencial' | 'destrutiva';

export interface Agente {
  id: string;                 // 'claude', 'codex', 'gemini', 'ollama:llama3', ...
  nick: string;               // nome exibido e usado na mencao (@nick)
  apelidos: string[];         // mencoes alternativas, ex.: ['ag', 'antigravity'] para gemini
  tipo: TipoProvedor;
  origem: 'embutido' | 'manifesto' | 'extensao';
  instalado: boolean;
  versao?: string;
  login: EstadoLogin;
  conta?: string;             // v2: identificacao mascarada da conta conectada
  opcoesLogin: OpcaoLogin[];  // v2: metodos oferecidos para este agente (vazio = nao precisa de login, ex. Ollama local)
  habilitado: boolean;
  papel: string;              // texto livre definido pelo usuario
  modo: ModoAgente;
  estado: EstadoAgente;
  cor: string;                // token de cor sugerido: 'amarelo' | 'verde' | 'magenta' | 'azul' | 'ciano' | 'laranja'
  suportaImagem: boolean;
  temSessao: boolean;
}

export interface Anexo {
  id: string;
  nome: string;
  tipo: 'texto' | 'imagem' | 'pdf' | 'docx' | 'planilha' | 'outro';
  bytes: number;
  // integral | amostra (planilha/truncado) | metadados (so nome e tamanho) | recusado
  tratamento: 'integral' | 'amostra' | 'metadados' | 'recusado';
  aviso?: string;             // explica truncamento, amostra ou recusa
  miniatura?: string;         // data URI pequena (<= 64 KB), apenas para imagens
}

export interface ContextoImportado {
  id: string;
  origem: 'claude-code' | 'codex' | 'sala-terminal' | 'sala-orquestra';
  titulo: string;
  caracteres: number;
}

export interface Mensagem {
  id: string;
  sala: string;
  quando: string;             // ISO 8601 local
  autor: string;              // nick do usuario ou do agente; 'sistema' para avisos
  tipo: 'fala' | 'acao' | 'sistema' | 'erro';
  texto: string;              // markdown para 'fala'; texto simples para os demais
  anexos?: { id: string; nome: string; tipo: Anexo['tipo'] }[]; // [v1.1] era string[]; o webview precisa do nome apos o envio
  parcial?: boolean;          // true enquanto o agente ainda esta escrevendo esta fala
}

export interface PedidoAprovacao {
  id: string;
  agente: string;
  categoria: CategoriaAcao;
  resumo: string;             // frase curta: "Escrever src/x.ts (2 KB)"
  detalhe: string;            // comando, caminho, URL, diff resumido
  critica: boolean;           // destrutiva, publicacao ou credencial
  expiraEm?: string;          // ISO; sem resposta ate la, a acao e negada
}

export type DecisaoAprovacao = 'aprovar' | 'aprovar_sessao' | 'negar';

export interface Configuracao {
  nivel: NivelPermissao;
  nivelConfirmadoEm?: string; // quando o usuario aceitou o aviso do nivel 'total'
  passagensAutomaticas: number;
  timeoutMinutos: number;
  nick: string;
  topico: string;
  limites: {
    textoIntegralKB: number;
    textoMaxMB: number;
    imagemMaxMB: number;
    documentoMaxMB: number;
    planilhaMaxMB: number;
    planilhaLinhasPorAba: number;
    planilhaAbas: number;
  };
}

export interface EstadoSala {
  versaoProtocolo: number;
  sala: { id: string; projeto: string | null; titulo: string };
  configuracao: Configuracao;
  agentes: Agente[];
  mensagens: Mensagem[];      // ultimas N; mais antigas via 'carregarAnteriores'
  anexosPendentes: Anexo[];   // anexados ao rascunho, ainda nao enviados
  contextos: ContextoImportado[];
  aprovacoes: PedidoAprovacao[];
  primeiraExecucao: boolean;  // true -> webview mostra o assistente
  voz: { disponivel: boolean; motivo?: string; gravando: boolean };
}

// ---------- webview -> host ----------

export type DoWebview =
  | { tipo: 'pronto' }
  | { tipo: 'enviar'; texto: string; anexos: string[] }
  | { tipo: 'parar' }
  | { tipo: 'carregarAnteriores'; antesDe: string }
  | { tipo: 'anexarArquivos' }                                  // host abre o seletor nativo
  | { tipo: 'anexarDados'; nome: string; mime: string; base64: string } // colar ou arrastar
  | { tipo: 'anexarCaminhos'; uris: string[] }                // [v1.1] arrastado do Explorer do VS Code (file:// ou vscode-uri)
  | { tipo: 'removerAnexo'; id: string }
  | { tipo: 'importarContexto' }                               // host abre QuickPick
  | { tipo: 'removerContexto'; id: string }
  | { tipo: 'responderAprovacao'; id: string; decisao: DecisaoAprovacao }
  | { tipo: 'agenteHabilitar'; id: string; habilitado: boolean }
  | { tipo: 'agenteModo'; id: string; modo: ModoAgente }
  | { tipo: 'agentePapel'; id: string; papel: string }
  | { tipo: 'loginIniciar'; id: string; metodo: MetodoLogin; variante?: string }   // v2 (substitui agenteLogin)
  | { tipo: 'loginChave'; id: string; chave: string; baseUrl?: string } // v2: chave so trafega neste sentido, uma vez
  | { tipo: 'loginCancelar'; id: string }
  | { tipo: 'logout'; id: string }
  | { tipo: 'abrirLinkLogin'; url: string }                    // v2: links de login/console nao passam pelo Portao (acao do proprio usuario); host aceita so URLs de login conhecidas
  | { tipo: 'agenteNovaSessao'; id: string }
  | { tipo: 'agenteConfigurar'; id: string }                   // [v1.1] host abre os settings fagulha.provedores.<id> (modelo, baseUrl, comando)
  | { tipo: 'instalarAgente' }                                 // host oferece manifesto ou extensao
  | { tipo: 'configurar'; parcial: Partial<Omit<Configuracao, 'nivel' | 'nivelConfirmadoEm'>> }
  | { tipo: 'definirNivel'; nivel: NivelPermissao; confirmacao?: string } // 'total' exige confirmacao === 'ACEITO OS RISCOS'
  | { tipo: 'concluirAssistente' }
  | { tipo: 'vozIniciar' }
  | { tipo: 'vozParar' }
  | { tipo: 'abrirLink'; url: string }                         // passa pelo Portao (categoria navegador)
  | { tipo: 'exportarConversa' };                              // unica saida de dados, sempre explicita

// ---------- host -> webview ----------

export type DoHost =
  | { tipo: 'estado'; estado: EstadoSala }                     // estado completo (inicio e mudancas grandes)
  | { tipo: 'mensagem'; mensagem: Mensagem }                   // nova ou atualizacao (mesmo id substitui)
  | { tipo: 'anteriores'; mensagens: Mensagem[]; fim: boolean }
  | { tipo: 'agente'; agente: Agente }
  | { tipo: 'login'; progresso: ProgressoLogin }               // v2
  | { tipo: 'anexo'; anexo: Anexo }
  | { tipo: 'anexoRemovido'; id: string }
  | { tipo: 'contexto'; contexto: ContextoImportado }
  | { tipo: 'contextoRemovido'; id: string }
  | { tipo: 'aprovacao'; pedido: PedidoAprovacao }
  | { tipo: 'aprovacaoResolvida'; id: string; decisao: DecisaoAprovacao | 'expirada' }
  | { tipo: 'configuracao'; configuracao: Configuracao }
  | { tipo: 'voz'; gravando: boolean; transcricao?: string; erro?: string }
  | { tipo: 'aviso'; nivel: 'info' | 'alerta' | 'erro'; texto: string };

export const CONFIRMACAO_NIVEL_TOTAL = 'ACEITO OS RISCOS';
