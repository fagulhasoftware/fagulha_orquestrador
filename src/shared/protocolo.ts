// Contrato entre o webview (interface de chat) e o extension host.
// Alteracoes afetam a interface e a extensao: descreva o impacto no pull request (ver CONTRIBUTING.md).
// Regra: o webview nunca recebe segredos nem caminhos de arquivos de credenciais.

export const VERSAO_PROTOCOLO = 5; // v5: estagio do agente, perguntas guiadas, voz natural (0.3.0)

// ---------- dominio ----------

export type NivelPermissao = 'manual' | 'parcial' | 'total';
export type ModoAgente = 'leitura_escrita' | 'leitura' | 'escrita';
export type TipoProvedor = 'cli' | 'api';
export type EstadoLogin = 'conectado' | 'desconectado' | 'chave_configurada' | 'desconhecido';
export type EstadoAgente = 'livre' | 'na_fila' | 'trabalhando' | 'desabilitado' | 'erro';

// ---------- estagio do agente (v5) ----------
export type TipoFase =
  | 'pensando' | 'lendo' | 'pesquisando_web' | 'escrevendo' | 'executando'
  | 'aguardando_aprovacao' | 'aguardando_resposta' | 'respondendo'
  | 'concluido' | 'interrompido' | 'erro';   // as tres ultimas sao finais

export interface FaseAgente {
  tipo: TipoFase;
  detalhe?: string;           // arquivo, dominio, comando truncado; nunca segredos
  desde: string;              // ISO de inicio da fase (ou do fim, nas finais)
  duracaoMs?: number;         // somente nas fases finais: duracao total da execucao
}

// ---------- perguntas guiadas (v5) ----------
// O agente chama a ferramenta MCP perguntar_usuario e fica pausado ate a resposta.
export interface OpcaoPergunta { rotulo: string; descricao?: string; recomendada?: boolean }
export interface ItemPergunta {
  id: string;
  pergunta: string;
  opcoes: OpcaoPergunta[];    // 2 a 6
  multipla?: boolean;         // permite marcar varias opcoes
  permiteTexto?: boolean;     // campo "outra resposta"
}
export interface PerguntaAgente {
  id: string;
  agente: string;             // id do agente
  titulo?: string;
  perguntas: ItemPergunta[];  // 1 a 4
  criadaEm: string;
  expiraEm?: string;
}
export interface RespostaItem { id: string; opcoes: string[]; texto?: string }

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
  | 'publicacao' | 'credencial' | 'destrutiva'
  | 'memoria' | 'irreversivel_externo';

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
  fase?: FaseAgente;          // v5: estagio atual ou ultimo resultado
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

// ---------- chats e memoria (v4) ----------
// Um chat e uma conversa persistente. A janela abre o ultimo chat usado na sua pasta (ou o ultimo sem projeto).
// O menu Chats lista conversas de todos os projetos; abrir um chat de outro projeto mostra o historico completo,
// e os agentes continuam trabalhando na pasta da janela atual.
export interface ResumoChat {
  id: string;
  titulo: string;               // gerado da primeira mensagem; editavel
  projeto: string | null;       // pasta onde o chat foi criado (null = sem projeto)
  projetoNome: string | null;   // nome curto da pasta, para exibicao
  desteProjeto: boolean;        // true se o projeto do chat e a pasta desta janela
  criadoEm: string;             // ISO
  atualizadoEm: string;         // ISO da ultima mensagem
  mensagens: number;
  agentes: string[];            // nicks que participaram
  fixado: boolean;
  trecho?: string;              // somente em resultados de busca: trecho que casou (texto simples, curto)
}

// Memoria persistente: fatos curtos que valem para todos os chats do escopo e sao enviados como contexto aos agentes.
export interface Memoria {
  id: string;
  escopo: 'global' | 'projeto';
  projeto: string | null;       // pasta, quando escopo = 'projeto'
  projetoNome: string | null;
  texto: string;                // ate 500 caracteres; nunca segredos
  origem: 'usuario' | 'agente';
  agente?: string;              // nick, quando proposta por agente e aprovada pelo usuario
  ativa: boolean;               // desativada = guardada, mas nao enviada aos agentes
  criadaEm: string;
  atualizadaEm: string;
}

export interface EstadoSala {
  versaoProtocolo: number;
  sala: { id: string; projeto: string | null; titulo: string };  // sala da janela (pasta); id interno
  chat: ResumoChat;             // v4: chat aberto nesta janela
  memoriasAtivas: number;       // v4: quantas memorias (global + deste projeto) estao sendo enviadas aos agentes
  configuracao: Configuracao;
  agentes: Agente[];
  mensagens: Mensagem[];      // ultimas N; mais antigas via 'carregarAnteriores'
  anexosPendentes: Anexo[];   // anexados ao rascunho, ainda nao enviados
  contextos: ContextoImportado[];
  aprovacoes: PedidoAprovacao[];
  perguntas: PerguntaAgente[];   // v5: perguntas guiadas pendentes neste chat
  primeiraExecucao: boolean;  // true -> webview mostra o assistente
  voz: EstadoVoz;
}

// ---------- voz (v3) ----------
// Falar: ffmpeg grava o microfone num arquivo temporario; whisper.cpp transcreve localmente; o arquivo e
// apagado em seguida. Ouvir: voz nativa do sistema (Windows SAPI, macOS say, Linux spd-say).
// Nenhum audio ou transcricao sai do computador; o audio nunca e gravado no SQLite.
export type ComponenteVoz = 'ffmpeg' | 'whisper' | 'modelo' | 'piper' | 'voz_neural'; // v5: piper + voz pt_BR
export type ModeloVoz = 'base' | 'small' | 'medium';
export type SituacaoComponente = 'instalado' | 'ausente' | 'instalando' | 'erro' | 'manual';
// 'manual': o sistema nao permite instalacao automatica (macOS/Linux para ffmpeg/whisper); ver 'comandoManual'.

export interface ItemInstalacaoVoz {
  componente: ComponenteVoz;
  situacao: SituacaoComponente;
  nome: string;              // ex.: 'ffmpeg 7.1 (build oficial)', 'Modelo small (portugues)'
  origem?: string;           // host de onde sera baixado, ex.: 'github.com', 'huggingface.co'
  tamanhoBytes?: number;     // tamanho do download, exibido antes do consentimento
  comandoManual?: string;    // ex.: 'brew install ffmpeg whisper-cpp'
  mensagem?: string;         // erro ou observacao em portugues
}

export interface ProgressoInstalacaoVoz {
  componente: ComponenteVoz;
  etapa: 'baixando' | 'verificando' | 'extraindo' | 'concluido' | 'erro' | 'cancelado';
  baixadoBytes?: number;
  totalBytes?: number;
  mensagem?: string;
}

export type MotorLeitura = 'sistema' | 'piper' | 'nuvem';

export interface EstadoVoz {
  disponivel: boolean;        // gravar + transcrever prontos
  motivo?: string;            // por que nao esta disponivel
  gravando: boolean;
  transcrevendo: boolean;
  segundosGravados?: number;  // atualizado pelo host durante a gravacao
  limiteSegundos: number;     // duracao maxima de uma gravacao (padrao 120)
  componentes: ItemInstalacaoVoz[];
  dispositivos: { id: string; nome: string }[];  // microfones detectados
  dispositivo?: string;       // id escolhido; vazio = padrao do sistema
  modelo: ModeloVoz;          // padrao 'small'
  idioma: 'pt' | 'en' | 'es' | 'auto';
  envioAutomatico: boolean;   // true: transcricao e enviada direto; false: vai para a caixa de texto
  leitura: {
    disponivel: boolean;      // voz do sistema encontrada
    motivo?: string;
    ativa: boolean;           // ler automaticamente as falas dos agentes
    vozes: { id: string; nome: string }[];
    voz?: string;
    velocidade: number;       // 0.5 a 2.0
    falando?: string;         // id da Mensagem sendo lida
    // v5: le somente perguntas, anuncio antes de agir e resumo ao concluir (leitura automatica)
    motor: MotorLeitura;
    motores: { id: MotorLeitura; disponivel: boolean; motivo?: string }[];
    variacao: number;         // 0 a 1: variacao de entonacao (personalidade); usado por piper e nuvem
    nuvem: { provedor: 'openai' | 'elevenlabs' | null; chaveConfigurada: boolean };
  };
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
  | { tipo: 'vozParar' }                                        // para e transcreve
  | { tipo: 'vozDescartar' }                                    // v3: para sem transcrever
  | { tipo: 'vozInstalar'; componentes: ComponenteVoz[] }       // v3: o clique e o consentimento; host so baixa o listado
  | { tipo: 'vozCancelarInstalacao' }
  | { tipo: 'vozConfigurar'; dispositivo?: string; modelo?: ModeloVoz; idioma?: EstadoVoz['idioma']; envioAutomatico?: boolean }
  | { tipo: 'leituraConfigurar'; ativa?: boolean; voz?: string; velocidade?: number; motor?: MotorLeitura; variacao?: number }
  | { tipo: 'leituraNuvemChave'; provedor: 'openai' | 'elevenlabs'; chave: string } // v5: validada antes de gravar
  | { tipo: 'leituraNuvemRemover' }
  | { tipo: 'responderPergunta'; id: string; respostas: RespostaItem[] }  // v5
  | { tipo: 'cancelarPergunta'; id: string }
  | { tipo: 'lerMensagem'; id: string }                         // le uma fala especifica
  | { tipo: 'pararLeitura' }
  | { tipo: 'abrirLink'; url: string }                         // passa pelo Portao (categoria navegador)
  | { tipo: 'exportarConversa' }
  // v4: chats
  | { tipo: 'novoChat' }
  | { tipo: 'listarChats'; busca?: string }                   // busca local em titulos e mensagens
  | { tipo: 'abrirChat'; id: string }                         // host responde com 'estado' completo do chat
  | { tipo: 'renomearChat'; id: string; titulo: string }
  | { tipo: 'fixarChat'; id: string; fixado: boolean }
  | { tipo: 'excluirChat'; id: string }                       // confirmacao ja feita na interface; apaga mensagens, acoes e anexos do chat
  | { tipo: 'exportarChat'; id: string }
  // v4: memoria
  | { tipo: 'listarMemorias' }
  | { tipo: 'salvarMemoria'; id?: string; escopo: Memoria['escopo']; texto: string; ativa?: boolean } // sem id = nova
  | { tipo: 'excluirMemoria'; id: string };                              // unica saida de dados, sempre explicita

// ---------- host -> webview ----------

export type DoHost =
  | { tipo: 'estado'; estado: EstadoSala }                     // estado completo (inicio e mudancas grandes)
  | { tipo: 'mensagem'; mensagem: Mensagem }                   // nova ou atualizacao (mesmo id substitui)
  | { tipo: 'anteriores'; mensagens: Mensagem[]; fim: boolean }
  | { tipo: 'agente'; agente: Agente }
  | { tipo: 'login'; progresso: ProgressoLogin }               // v2
  | { tipo: 'fase'; agente: string; fase: FaseAgente }          // v5
  | { tipo: 'pergunta'; pergunta: PerguntaAgente }             // v5
  | { tipo: 'perguntaResolvida'; id: string; situacao: 'respondida' | 'cancelada' | 'expirada' }
  | { tipo: 'anexo'; anexo: Anexo }
  | { tipo: 'anexoRemovido'; id: string }
  | { tipo: 'contexto'; contexto: ContextoImportado }
  | { tipo: 'contextoRemovido'; id: string }
  | { tipo: 'aprovacao'; pedido: PedidoAprovacao }
  | { tipo: 'aprovacaoResolvida'; id: string; decisao: DecisaoAprovacao | 'expirada' }
  | { tipo: 'configuracao'; configuracao: Configuracao }
  | { tipo: 'voz'; gravando: boolean; transcricao?: string; erro?: string }  // v1, mantido
  | { tipo: 'estadoVoz'; voz: EstadoVoz }                        // v3: estado completo da voz
  | { tipo: 'vozInstalacao'; progresso: ProgressoInstalacaoVoz } // v3
  | { tipo: 'aviso'; nivel: 'info' | 'alerta' | 'erro'; texto: string }
  | { tipo: 'chats'; lista: ResumoChat[]; busca?: string }   // v4: resposta a listarChats e apos mudancas
  | { tipo: 'chat'; chat: ResumoChat }                        // v4: chat atual mudou (titulo, contagem, fixado)
  | { tipo: 'memorias'; lista: Memoria[] };                   // v4: resposta a listarMemorias e apos mudancas

export const CONFIRMACAO_NIVEL_TOTAL = 'ACEITO OS RISCOS';
