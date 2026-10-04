import type { DoHost, MetodoLogin, OpcaoLogin, ProgressoLogin } from '../shared/protocolo';
import type { Provedor, Segredos } from './tipos';
import { mascarar, protegerSegredo } from '../core/seguranca';
import { rodar } from './processo';

export type TipoChave = 'openai' | 'anthropic' | 'gemini' | 'compativel';
export interface ConfigLogin {
  segredos: Segredos;
  segredoId: string;
  tipoChave?: TipoChave;
  baseUrl?: () => string;
  salvarBaseUrl?: (url: string) => Promise<void>;
  comando?: (
    args: string[],
    sinal: AbortSignal,
    saida?: (texto: string) => void,
    stdin?: string,
  ) => Promise<string>;
}

export function opcoesLogin(id: string): OpcaoLogin[] {
  const openai = 'https://platform.openai.com/api-keys';
  const google = 'https://aistudio.google.com/apikey';
  if (id === 'claude')
    return [
      { metodo: 'navegador', rotulo: 'Assinatura Claude', variante: 'claudeai' },
      { metodo: 'navegador', rotulo: 'Anthropic Console', variante: 'console' },
    ];
  if (id === 'codex')
    return [
      { metodo: 'navegador', rotulo: 'Conta ChatGPT' },
      { metodo: 'dispositivo', rotulo: 'Código de dispositivo' },
      { metodo: 'chave', rotulo: 'Chave de API OpenAI', linkChave: openai },
    ];
  if (id === 'gemini' || id === 'gemini-api')
    return [{ metodo: 'chave', rotulo: 'Chave do Google AI Studio', linkChave: google }];
  if (id === 'anthropic')
    return [
      {
        metodo: 'chave',
        rotulo: 'Chave da Anthropic',
        linkChave: 'https://console.anthropic.com/settings/keys',
      },
    ];
  if (id === 'openai-api')
    return [{ metodo: 'chave', rotulo: 'Chave de API OpenAI', linkChave: openai }];
  if (id === 'openai-compativel')
    return [{ metodo: 'chave', rotulo: 'Chave e endereço da API', variante: 'com_baseUrl' }];
  return [];
}

export class ErroLogin extends Error {}
export function baseApi(valor: string): string {
  let url: URL;
  try {
    url = new URL(valor);
  } catch {
    throw new ErroLogin('Informe um endereço válido para a API.');
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
  ) {
    throw new ErroLogin(
      'A API exige HTTPS; HTTP é permitido somente no computador local. Não inclua credenciais no endereço.',
    );
  }
  return url.href.replace(/\/+$/, '');
}

export async function validarChave(
  tipo: TipoChave,
  chave: string,
  opcoes: {
    baseUrl?: string;
    sinal?: AbortSignal;
    timeoutMs?: number;
    endpointTeste?: string;
  } = {},
): Promise<void> {
  protegerSegredo(chave);
  if (
    !/^[\x21-\x7e]{12,4096}$/.test(chave) ||
    (tipo === 'openai' && !/^sk-[\w-]{16,}$/.test(chave)) ||
    (tipo === 'anthropic' && !/^sk-ant-[\w-]{16,}$/.test(chave)) ||
    (tipo === 'gemini' && !/^AIza[\w-]{20,}$/.test(chave))
  ) {
    throw new ErroLogin('O formato da chave é inválido. Copie a chave completa do provedor.');
  }
  const endpoint =
    opcoes.endpointTeste ??
    (tipo === 'openai'
      ? 'https://api.openai.com/v1/models'
      : tipo === 'anthropic'
        ? 'https://api.anthropic.com/v1/models'
        : tipo === 'gemini'
          ? 'https://generativelanguage.googleapis.com/v1beta/models'
          : `${baseApi(opcoes.baseUrl ?? '')}/models`);
  const headers: Record<string, string> =
    tipo === 'anthropic'
      ? { 'x-api-key': chave, 'anthropic-version': '2023-06-01' }
      : tipo === 'gemini'
        ? { 'x-goog-api-key': chave }
        : { Authorization: `Bearer ${chave}` };
  try {
    const sinal = AbortSignal.any([
      opcoes.sinal ?? new AbortController().signal,
      AbortSignal.timeout(opcoes.timeoutMs ?? 15_000),
    ]);
    const resposta = await fetch(endpoint, {
      method: 'GET',
      headers,
      signal: sinal,
      redirect: 'error',
    });
    await resposta.body?.cancel();
    if (resposta.status === 401 || resposta.status === 403)
      throw new ErroLogin('Chave recusada pelo provedor');
    if (!resposta.ok)
      throw new ErroLogin(
        `O provedor não conseguiu validar a chave (HTTP ${resposta.status}). Tente novamente.`,
      );
  } catch (e) {
    if (e instanceof ErroLogin) throw e;
    throw new ErroLogin(
      'Não foi possível validar a chave. Verifique a conexão e tente novamente (limite de 15 segundos).',
    );
  }
}

const dominiosLogin = [
  'anthropic.com',
  'claude.ai',
  'claude.com',
  'openai.com',
  'chatgpt.com',
  'auth.openai.com',
  'aistudio.google.com',
  'google.com',
  'accounts.google.com',
];
export function validarLinkLogin(valor: string, emitidas: Iterable<string> = []): string {
  let url: URL;
  try {
    url = new URL(valor);
  } catch {
    throw new ErroLogin('Link de login inválido.');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    (!dominiosLogin.some((d) => url.hostname === d || url.hostname.endsWith(`.${d}`)) &&
      ![...emitidas].includes(url.href))
  ) {
    throw new ErroLogin('Este endereço não é permitido para login.');
  }
  return url.href;
}

export function lerSaidaLogin(texto: string): { url?: string; codigo?: string } {
  const limpo = texto.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
  const urls = [...limpo.matchAll(/https:\/\/[^\s<>"'\x1b]+/g)].map((m) =>
    m[0].replace(/[).,;]+$/, ''),
  );
  const url = urls.find((u) => /\/(?:oauth|authorize|device|auth|login)/i.test(u)) ?? urls[0];
  const codigo =
    limpo.match(
      /(?:user\s+code|device\s+code|one[- ]time\s+code|code|código)\s*(?:is\s*)?[:=]?\s*(?:\r?\n\s*)?([A-Z0-9]{4}[- ][A-Z0-9]{4})(?![A-Z0-9])/i,
    )?.[1] ?? limpo.match(/(?:^|\n)\s*([A-Z0-9]{4}-[A-Z0-9]{4})\s*(?:\n|$)/)?.[1];
  return { url, codigo: codigo?.toUpperCase().replace(' ', '-') };
}

export function contaMascarada(email?: unknown, plano?: unknown): string | undefined {
  if (typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const [nome, dominio] = email.split('@');
    return mascarar(`${nome[0]}***@${dominio}`).slice(0, 100);
  }
  if (
    typeof plano === 'string' &&
    /^(free|plus|pro|max|team|teams|enterprise|claudeai|console|chatgpt)$/i.test(plano)
  )
    return plano;
  return undefined;
}

// A saída bruta fica somente em memória. Nunca devolvemos stderr/argv de autenticação.
export async function rodarLogin(
  cmd: string,
  args: string[],
  opcoes: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    sinal: AbortSignal;
    saida?: (texto: string) => void;
    stdin?: string;
  },
): Promise<string> {
  let capturado = '';
  try {
    await rodar(cmd, args, {
      cwd: opcoes.cwd,
      env: opcoes.env,
      sinal: opcoes.sinal,
      stdin: opcoes.stdin,
      timeoutMs: 5 * 60_000,
      trecho: (texto) => {
        capturado = (capturado + texto).slice(-32_000);
        opcoes.saida?.(mascarar(texto));
      },
    });
    return capturado;
  } catch {
    if (
      /requires? (?:a )?(?:tty|terminal)|not a tty|stdin is not a terminal|raw mode|interactive terminal/i.test(
        capturado,
      )
    )
      throw new ErroLogin('Este CLI exige um terminal interativo.');
    throw new ErroLogin(
      'O CLI não concluiu o login. Verifique sua conexão, atualize o CLI e tente novamente.',
    );
  }
}

interface Fluxo {
  controle: AbortController;
  metodo: MetodoLogin | 'logout';
  progresso: ProgressoLogin;
  url?: string;
  expirou: boolean;
  tarefa: Promise<void>;
}
export interface DependenciasLogin {
  provedor: (id: string) => Provedor | undefined;
  emitir: (evento: DoHost) => void;
  abrir: (url: string) => Promise<void>;
  auditar: (resumo: string) => Promise<void>;
  validar?: typeof validarChave;
  timeoutMs?: number;
}
export class GestorLogin {
  private fluxos = new Map<string, Fluxo>();
  constructor(private deps: DependenciasLogin) {}

  progresso(): ProgressoLogin[] {
    return [...this.fluxos.values()].map((f) => f.progresso);
  }
  private emitir(f: Fluxo, progresso: ProgressoLogin): void {
    f.progresso = progresso;
    this.deps.emitir({ tipo: 'login', progresso });
  }
  private conferir(f: Fluxo): void {
    if (f.controle.signal.aborted) throw new ErroLogin('Login cancelado.');
  }
  private async fluxo(
    id: string,
    metodo: MetodoLogin | 'logout',
    trabalho: (p: Provedor, f: Fluxo) => Promise<void>,
  ): Promise<void> {
    const anterior = this.fluxos.get(id);
    if (anterior) this.cancelar(id);
    const f: Fluxo = {
      controle: new AbortController(),
      metodo,
      progresso: { agente: id, etapa: 'iniciando' },
      expirou: false,
      tarefa: Promise.resolve(),
    };
    this.fluxos.set(id, f);
    const timer = setTimeout(
      () => {
        f.expirou = true;
        f.controle.abort();
      },
      this.deps.timeoutMs ?? 5 * 60_000,
    );
    f.tarefa = (async () => {
      let resultado = 'erro';
      try {
        await anterior?.tarefa;
        this.conferir(f);
        const p = this.deps.provedor(id);
        if (!p?.autenticacao) throw new ErroLogin('Este agente não oferece login pela interface.');
        this.emitir(f, { agente: id, etapa: 'iniciando', mensagem: 'Iniciando login…' });
        await trabalho(p, f);
        this.conferir(f);
        resultado = metodo === 'logout' ? 'desconectado' : 'conectado';
        this.deps.emitir({ tipo: 'agente', agente: p.agente });
        this.emitir(f, {
          agente: id,
          etapa: metodo === 'logout' ? 'cancelado' : 'conectado',
          conta: p.agente.conta,
          mensagem: metodo === 'logout' ? 'Você saiu da conta.' : 'Login confirmado.',
        });
      } catch (e) {
        resultado = f.controle.signal.aborted && !f.expirou ? 'cancelado' : 'erro';
        if (resultado !== 'cancelado')
          this.emitir(f, {
            agente: id,
            etapa: 'erro',
            mensagem: f.expirou
              ? 'O login excedeu 5 minutos. Inicie novamente.'
              : e instanceof ErroLogin
                ? mascarar(e.message)
                : 'Não foi possível concluir o login. Tente novamente.',
          });
      } finally {
        clearTimeout(timer);
        if (this.fluxos.get(id) === f) this.fluxos.delete(id);
        await this.deps.auditar(`login ${id} ${metodo} ${resultado}`).catch(() => {});
      }
    })();
    await f.tarefa;
  }

  async iniciar(id: string, metodo: MetodoLogin, variante?: string): Promise<void> {
    await this.fluxo(id, metodo, async (p, f) => {
      if (
        !p.agente.opcoesLogin.some((o) => o.metodo === metodo && o.variante === variante) ||
        metodo === 'chave'
      )
        throw new ErroLogin('Escolha uma das opções de login disponíveis para este agente.');
      const comando = p.autenticacao!.comando;
      if (!comando)
        throw new ErroLogin('Login pelo navegador não está disponível para este agente.');
      let buffer = '';
      let parserTimer: ReturnType<typeof setTimeout> | undefined;
      const interpretar = () => {
        if (f.controle.signal.aborted || this.fluxos.get(id) !== f) return;
        const instrucao = lerSaidaLogin(buffer);
        publicar(instrucao);
      };
      const emitirSaida = (texto: string) => {
        if (f.controle.signal.aborted) return;
        buffer = (buffer + texto).slice(-32_000);
        clearTimeout(parserTimer);
        const fim = buffer.lastIndexOf('\n');
        if (fim >= 0) publicar(lerSaidaLogin(buffer.slice(0, fim + 1)));
        // Alguns CLIs escrevem instruções sem newline. Aguarda o fim da rajada de chunks.
        parserTimer = setTimeout(interpretar, 200);
      };
      const publicar = (instrucao: ReturnType<typeof lerSaidaLogin>) => {
        if (!instrucao.url) return;
        // Somente domínios conhecidos são aceitos ao extrair URLs de um processo.
        let url: string;
        try {
          url = validarLinkLogin(instrucao.url);
        } catch {
          return;
        }
        if (metodoAtual === 'dispositivo' && !instrucao.codigo) return;
        const igual = f.url === url && f.progresso.codigo === instrucao.codigo;
        if (igual) return;
        const abrir = f.url !== url;
        f.url = url;
        this.emitir(f, {
          agente: id,
          etapa: metodoAtual === 'dispositivo' ? 'codigo_dispositivo' : 'aguardando_navegador',
          url,
          ...(metodoAtual === 'dispositivo' ? { codigo: instrucao.codigo } : {}),
          mensagem:
            metodoAtual === 'dispositivo'
              ? 'Abra o link e informe este código para entrar.'
              : 'Conclua o login no navegador.',
        });
        if (abrir)
          void this.deps.abrir(url).catch(() => {
            if (!f.controle.signal.aborted && this.fluxos.get(id) === f)
              this.emitir(f, {
                ...f.progresso,
                mensagem: 'Não foi possível abrir o navegador. Use o link acima.',
              });
          });
      };
      let metodoAtual = metodo;
      const args =
        id === 'claude'
          ? ['auth', 'login', `--${variante}`]
          : ['login', ...(metodo === 'dispositivo' ? ['--device-auth'] : [])];
      try {
        await comando(args, f.controle.signal, emitirSaida);
      } catch (e) {
        this.conferir(f);
        if (
          id !== 'codex' ||
          metodo !== 'navegador' ||
          !(e instanceof ErroLogin) ||
          !/terminal interativo/.test(e.message)
        )
          throw e;
        metodoAtual = 'dispositivo';
        buffer = '';
        f.url = undefined;
        await comando(['login', '--device-auth'], f.controle.signal, emitirSaida);
      } finally {
        clearTimeout(parserTimer);
      }
      interpretar();
      this.conferir(f);
      p.agente.login = await p.estadoLogin(f.controle.signal);
      this.conferir(f);
      if (p.agente.login !== 'conectado')
        throw new ErroLogin(
          'O processo terminou, mas o provedor não confirmou o login. Tente novamente.',
        );
      p.agente.conta ??=
        id === 'codex' ? 'ChatGPT' : variante === 'console' ? 'Anthropic Console' : 'Claude';
    });
  }

  async chave(id: string, chave: string, baseUrl?: string): Promise<void> {
    protegerSegredo(chave);
    await this.fluxo(id, 'chave', async (p, f) => {
      const auth = p.autenticacao!;
      if (!p.agente.opcoesLogin.some((o) => o.metodo === 'chave') || !auth.tipoChave)
        throw new ErroLogin('Este agente não aceita chave de API.');
      this.emitir(f, {
        agente: id,
        etapa: 'validando',
        mensagem: 'Validando a chave com o provedor…',
      });
      const endpoint =
        auth.tipoChave === 'compativel' ? baseApi(baseUrl ?? auth.baseUrl?.() ?? '') : undefined;
      await (this.deps.validar ?? validarChave)(auth.tipoChave, chave, {
        baseUrl: endpoint,
        sinal: f.controle.signal,
      });
      this.conferir(f);
      if (id === 'codex') {
        if (!auth.comando) throw new ErroLogin('Codex CLI não encontrado.');
        await auth.comando(['login', '--with-api-key'], f.controle.signal, undefined, `${chave}\n`);
        this.conferir(f);
        if ((await p.estadoLogin(f.controle.signal)) !== 'conectado')
          throw new ErroLogin('O Codex não confirmou o login com a chave.');
        this.conferir(f);
      }
      const anterior = await auth.segredos.get(auth.segredoId);
      this.conferir(f);
      await auth.segredos.store(auth.segredoId, chave);
      try {
        this.conferir(f);
        if (endpoint && auth.salvarBaseUrl) await auth.salvarBaseUrl(endpoint);
        this.conferir(f);
      } catch (e) {
        if (anterior) await auth.segredos.store(auth.segredoId, anterior);
        else await auth.segredos.delete?.(auth.segredoId);
        throw e;
      }
      p.agente.login = 'conectado';
      p.agente.conta = `chave ...${chave.slice(-4)}`;
    });
  }

  cancelar(id: string): void {
    const f = this.fluxos.get(id);
    if (!f || f.controle.signal.aborted) return;
    f.controle.abort();
    this.emitir(f, { agente: id, etapa: 'cancelado', mensagem: 'Login cancelado.' });
  }
  async abrir(url: string): Promise<void> {
    await this.deps.abrir(
      validarLinkLogin(
        url,
        [...this.fluxos.values()].flatMap((f) =>
          f.url && !f.controle.signal.aborted ? [f.url] : [],
        ),
      ),
    );
  }
  async logout(id: string): Promise<void> {
    await this.fluxo(id, 'logout', async (p, f) => {
      const auth = p.autenticacao!;
      let falhou = false;
      try {
        if (auth.comando && (id === 'claude' || id === 'codex'))
          await auth.comando(
            id === 'claude' ? ['auth', 'logout'] : ['logout'],
            AbortSignal.any([f.controle.signal, AbortSignal.timeout(15_000)]),
          );
      } catch {
        falhou = true;
      }
      this.conferir(f);
      if (!auth.segredos.delete)
        throw new ErroLogin('O armazenamento de credenciais não oferece remoção.');
      await auth.segredos.delete(auth.segredoId);
      p.agente.conta = undefined;
      p.agente.login = falhou ? await p.estadoLogin(f.controle.signal) : 'desconectado';
      if (falhou) {
        this.deps.emitir({ tipo: 'agente', agente: p.agente });
        throw new ErroLogin(
          'A chave local foi removida, mas o CLI não confirmou a saída da conta. Tente novamente.',
        );
      }
    });
  }
  async finalizar(): Promise<void> {
    const tarefas = [...this.fluxos.values()].map((f) => f.tarefa);
    for (const id of this.fluxos.keys()) this.cancelar(id);
    await Promise.all(tarefas);
  }
}
