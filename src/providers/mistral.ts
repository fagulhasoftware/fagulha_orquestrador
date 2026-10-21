import { access, mkdir, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { ClienteAcp, ErroAcp } from './acp';
import { ambienteConta } from './autenticacao';
import {
  agentePadrao,
  type Provedor,
  type Segredos,
  type PedidoExecucao,
  type EventosProvedor,
} from './tipos';
import { baseApi, ErroLogin, validarLinkLogin, type ConfigLogin } from './login';
import { catalogoConfigurado, type ConfigModelos } from './modelos';
import { protegerPreferenciasVibe } from './perfil-mistral';
import { mascarar } from '../core/seguranca';

export type MistralId = 'mistral-vibe' | 'mistral-enterprise';
export async function localizarVibe(
  configurado?: string,
  raiz = join(homedir(), '.vscode', 'extensions'),
) {
  if (configurado)
    return /\.[cm]?js$/i.test(configurado)
      ? { cmd: process.execPath, prefixo: [configurado] }
      : { cmd: configurado, prefixo: [] };
  try {
    for (const pasta of (await readdir(raiz))
      .filter((n) => n.startsWith('mistralai.mistral-vibe-code-'))
      .sort()
      .reverse()) {
      const cmd = join(
        raiz,
        pasta,
        'bin',
        process.platform === 'win32' ? 'vibe-acp.exe' : 'vibe-acp',
      );
      try {
        await access(cmd);
        return { cmd, prefixo: [] };
      } catch {}
    }
  } catch {}
  for (const d of (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':')) {
    const cmd = join(d, process.platform === 'win32' ? 'vibe-acp.exe' : 'vibe-acp');
    try {
      await access(cmd);
      return { cmd, prefixo: [] };
    } catch {}
  }
  return undefined;
}

export class ProvedorMistral implements Provedor {
  agente;
  autenticacao: ConfigLogin;
  private bin?: { cmd: string; prefixo: string[] };
  constructor(
    readonly id: MistralId,
    private pastaConta: string,
    segredos: Segredos,
    private opcoes: () => ConfigModelos & { comando?: string; baseUrl?: string } = () => ({}),
    private permitir: (titulo: string, sinal: AbortSignal) => Promise<boolean> = async () => false,
  ) {
    this.agente = agentePadrao(
      id,
      id === 'mistral-vibe' ? 'MistralVibe' : 'MistralEnterprise',
      'cli',
      'laranja',
      id === 'mistral-vibe' ? ['mistral', 'vibe'] : ['mistralcode'],
    );
    this.agente.autenticacaoModo = id === 'mistral-enterprise' ? 'empresa' : 'conta';
    this.agente.opcoesLogin = [
      {
        metodo: 'navegador',
        rotulo:
          id === 'mistral-enterprise' ? 'Conta Mistral Code Enterprise' : 'Conta Mistral Vibe',
      },
    ];
    this.autenticacao = {
      segredos,
      segredoId: `fagulha.conta.${id}`,
      loginConta: (sinal, saida) => this.entrar(sinal, saida),
      logoutConta: (sinal) => this.sair(sinal),
      linkContaPermitido: (url) => this.linkPermitido(url),
    };
  }
  private linkPermitido(valor: string): boolean {
    try {
      const u = new URL(valor);
      if (u.protocol !== 'https:' || u.username || u.password) return false;
      const base = this.opcoes().baseUrl;
      return base
        ? u.origin === new URL(baseApi(base)).origin
        : u.hostname === 'mistral.ai' || u.hostname.endsWith('.mistral.ai');
    } catch {
      return false;
    }
  }
  private async cliente(
    sinal: AbortSignal,
    notificar?: (m: string, p: any) => void,
    pedido?: (m: string, p: any) => Promise<unknown>,
  ) {
    if (!this.bin)
      throw new ErroLogin(
        'Mistral Vibe ACP nao encontrado. Instale a extensao oficial ou configure o comando.',
      );
    await mkdir(this.pastaConta, { recursive: true });
    if (process.platform === 'darwin')
      throw new ErroLogin(
        'Perfis Mistral isolados no macOS ainda nao suportados: o runtime compartilha o Keychain nativo.',
      );
    const env = ambienteConta();
    for (const k of Object.keys(env)) if (/API_KEY$/i.test(k)) delete env[k];
    env.VIBE_HOME = this.pastaConta;
    // O keyring do Vibe usa uma chave global mesmo com VIBE_HOME distinto.
    // O backend fail aciona o armazenamento oficial no VIBE_HOME de cada perfil,
    // sem consultar, sobrescrever ou remover o login da extensao instalada.
    env.PYTHON_KEYRING_BACKEND = 'keyring.backends.fail.Keyring';
    const c = new ClienteAcp(this.bin, this.pastaConta, env, sinal, notificar, pedido);
    try {
      const info = await c.inicializar();
      return { c, info };
    } catch (e) {
      await c.fechar();
      throw e;
    }
  }
  async listarModelos() {
    const fallback = catalogoConfigurado(
      this.opcoes(),
      'ACP: entre na conta e atualize a lista; runtime precisa anunciar configuracao de modelo.',
    );
    if (!this.bin) return fallback;
    try {
      const { c } = await this.cliente(AbortSignal.timeout(20000));
      try {
        if (!(await this.status(c))) return fallback;
        const estado = await c.request('session/new', {
          cwd: resolve(this.pastaConta),
          mcpServers: [],
        });
        const modelo = opcaoAcp(estado, 'model');
        const pensar = opcaoAcp(estado, 'thinking');
        const esforcos = valoresAcp(pensar).map((o) => o.value);
        const modelos = valoresAcp(modelo).map((o) => ({
          id: o.value,
          nome: o.name ?? o.value,
          ...(esforcos.length ? { esforcos } : {}),
        }));
        return modelos.length ? { modelos, origem: 'runtime' as const } : fallback;
      } finally {
        await c.fechar();
      }
    } catch {
      return fallback;
    }
  }
  async detectar() {
    this.bin = await localizarVibe(this.opcoes().comando);
    if (!this.bin) return { instalado: false };
    try {
      const { c, info } = await this.cliente(AbortSignal.timeout(15000));
      await c.fechar();
      return {
        instalado: true,
        versao: mascarar(info.agentInfo?.version ?? 'ACP v1'),
        caminho: this.bin.cmd,
      };
    } catch {
      return { instalado: false };
    }
  }
  private async status(c: ClienteAcp) {
    const s = await c.request('_auth/status', {});
    if (s?.authenticated !== true || s.authState !== 'vibe_home_env_file') return false;
    const base = this.opcoes().baseUrl;
    // Um perfil corporativo nao pode cair silenciosamente na nuvem publica, nem o inverso.
    if (base)
      return (
        typeof s.customDomain === 'string' &&
        new URL(baseApi(base)).hostname ===
          new URL(
            baseApi(s.customDomain.includes('://') ? s.customDomain : `https://${s.customDomain}`),
          ).hostname
      );
    return !s.customDomain;
  }
  async estadoLogin(sinal: AbortSignal = AbortSignal.timeout(15000)) {
    if (!this.bin) return 'desconectado' as const;
    try {
      const { c } = await this.cliente(sinal);
      try {
        const ok = await this.status(c);
        this.agente.conta = ok
          ? this.id === 'mistral-enterprise'
            ? 'Perfil corporativo Mistral'
            : 'Conta nativa Mistral Vibe'
          : undefined;
        return ok ? ('conectado' as const) : ('desconectado' as const);
      } finally {
        await c.fechar();
      }
    } catch {
      return 'desconhecido' as const;
    }
  }
  private async entrar(sinal: AbortSignal, saida: (texto: string) => void) {
    const { c, info } = await this.cliente(sinal);
    try {
      if (!info.authMethods?.some((a: any) => a.id === 'browser-auth-delegated'))
        throw new ErroLogin(
          'Este runtime Mistral nao oferece login por navegador delegado. Atualize a extensao oficial.',
        );
      const base = this.opcoes().baseUrl;
      const params = {
        methodId: 'browser-auth-delegated',
        _meta: {
          action: 'start',
          ...(base
            ? { signInTarget: 'custom', domain: baseApi(base) }
            : { signInTarget: 'mistral' }),
        },
      };
      const inicio = await c.request('authenticate', params);
      const meta = inicio?._meta?.['browser-auth-delegated'];
      if (!meta?.attemptId || !this.linkPermitido(meta.signInUrl))
        throw new ErroLogin('Mistral retornou um link de login fora do dominio configurado.');
      validarLinkLogin(meta.signInUrl, [meta.signInUrl]);
      saida(meta.signInUrl + '\n');
      const resultado = await c.request(
        'authenticate',
        {
          methodId: 'browser-auth-delegated',
          _meta: { action: 'complete', attemptId: meta.attemptId },
        },
        0,
      );
      const conclusao = resultado?._meta?.['browser-auth-delegated'];
      if (conclusao?.attemptId !== meta.attemptId || conclusao?.status !== 'completed')
        throw new ErroLogin('Mistral nao concluiu a tentativa original de login. Tente novamente.');
      if (
        conclusao.persistResult !== 'completed' ||
        conclusao.persistProviderResult === 'failed' ||
        conclusao.persistConsoleBaseUrlResult === 'failed' ||
        conclusao.persistVibeBaseUrlResult === 'failed'
      )
        throw new ErroLogin(
          'Mistral autorizou no navegador, mas nao conseguiu salvar o login no perfil local. Verifique permissoes do perfil e tente novamente.',
        );
      if (!(await this.status(c)))
        throw new ErroLogin('Mistral nao confirmou a conta no perfil selecionado.');
    } catch (e) {
      throw e instanceof ErroLogin
        ? e
        : new ErroLogin(e instanceof Error ? e.message : 'Falha no login Mistral.');
    } finally {
      await c.fechar();
    }
  }
  private async sair(sinal: AbortSignal) {
    const { c } = await this.cliente(sinal);
    try {
      await c.request('_auth/signOut', {});
    } finally {
      await c.fechar();
    }
  }
  async login() {
    throw new Error('Entre pelo navegador no painel do participante Mistral.');
  }
  async executar(p: PedidoExecucao, ev: EventosProvedor, sinal: AbortSignal) {
    if (p.nivel !== 'total' || p.modo !== 'leitura_escrita')
      throw new Error(
        'Mistral ACP requer Total e leitura_escrita; isolamento dos outros modos ainda nao comprovado.',
      );
    await mkdir(this.pastaConta, { recursive: true });
    const preferencias = await protegerPreferenciasVibe(this.pastaConta, sinal);
    try {
      let texto = '',
        sessao: string | undefined,
        recebendo = false;
      const { c, info } = await this.cliente(
        sinal,
        (m, params) => {
          if (!recebendo || sinal.aborted || m !== 'session/update' || params.sessionId !== sessao)
            return;
          const u = params.update;
          if (u?.sessionUpdate === 'agent_message_chunk' && u.content?.type === 'text') {
            texto += u.content.text;
            if (Buffer.byteLength(texto) > 4 * 1024 * 1024)
              throw new ErroAcp('Resposta Mistral excedeu 4 MB.');
            ev.parcial(mascarar(u.content.text));
          } else if (u?.sessionUpdate === 'tool_call')
            ev.acao(mascarar(u.title ?? 'Ferramenta Mistral'));
        },
        async (m, params) => {
          if (m !== 'session/request_permission')
            throw new ErroAcp('Metodo ACP nao implementado.', -32601);
          if (sinal.aborted || params.sessionId !== sessao)
            return { outcome: { outcome: 'cancelled' } };
          const opcao = params.options?.find((o: any) => o.kind === 'allow_once');
          if (
            !opcao ||
            !(await this.permitir(
              mascarar(params.toolCall?.title ?? 'Ferramenta nativa Mistral'),
              sinal,
            ))
          )
            return { outcome: { outcome: 'cancelled' } };
          return { outcome: { outcome: 'selected', optionId: opcao.optionId } };
        },
      );
      try {
        if (!(await this.status(c)))
          throw new Error(
            'Mistral: entre com a conta deste perfil. Nenhuma chave de API sera usada como alternativa.',
          );
        const params = {
          cwd: resolve(p.projeto),
          mcpServers: [
            {
              name: 'fagulha_orquestrador',
              command: process.execPath,
              args: [p.ponte.servidor],
              env: [
                { name: 'ELECTRON_RUN_AS_NODE', value: '1' },
                { name: 'ORQUESTRA_BRIDGE_URL', value: p.ponte.url },
                { name: 'ORQUESTRA_BRIDGE_TOKEN', value: p.ponte.token },
              ],
            },
          ],
        };
        let estadoSessao: any;
        if (p.sessao && info.agentCapabilities?.loadSession === true) {
          sessao = p.sessao;
          estadoSessao = await c.request('session/load', { ...params, sessionId: sessao });
        } else {
          const nova = await c.request('session/new', params);
          if (typeof nova?.sessionId !== 'string')
            throw new ErroAcp('Mistral nao retornou uma sessao valida.');
          sessao = nova.sessionId;
          estadoSessao = nova;
        }
        // Aplicar tambem ao retomar: sessoes salvas podem estar em plan/chat.
        if (estadoSessao?.modes?.availableModes?.some((m: any) => m.id === 'auto-approve')) {
          await c.request('session/set_mode', { sessionId: sessao, modeId: 'auto-approve' });
          ev.acao(`${this.agente.nick}: acesso total nativo (auto-approve).`);
        }
        await preferencias.marcar();
        ev.sessao(sessao!);
        ev.acao(`${this.agente.nick}: perfil nativo isolado; sem chave da API Mistral.`);
        if (p.modelo) {
          const opcao = opcaoAcp(estadoSessao, 'model');
          if (!opcao || !valoresAcp(opcao).some((o) => o.value === p.modelo))
            throw new ErroAcp('Modelo indisponivel neste runtime Mistral.');
          estadoSessao = await c.request('session/set_config_option', {
            sessionId: sessao,
            configId: opcao.id,
            value: p.modelo,
          });
          await preferencias.marcar();
          ev.modelo?.(p.modelo);
        } else {
          const atual = opcaoAcp(estadoSessao, 'model')?.currentValue;
          if (typeof atual === 'string') ev.modelo?.(atual);
        }
        if (p.esforco) {
          const opcao = opcaoAcp(estadoSessao, 'thinking');
          if (!opcao || !valoresAcp(opcao).some((o) => o.value === p.esforco))
            throw new ErroAcp('Reasoning effort indisponivel neste modelo Mistral.');
          await c.request('session/set_config_option', {
            sessionId: sessao,
            configId: opcao.id,
            value: p.esforco,
          });
        }
        // session/load DEVE reproduzir historico ACP. Somente prompt gera saida nova.
        await preferencias.marcar();
        recebendo = true;
        const result = await c.request(
          'session/prompt',
          {
            sessionId: sessao,
            prompt: [
              {
                type: 'text',
                text:
                  p.sessao && info.agentCapabilities?.loadSession !== true
                    ? (p.promptCompleto ?? p.prompt)
                    : p.prompt,
              },
            ],
          },
          0,
        );
        if (result?.stopReason === 'cancelled')
          throw new ErroAcp('Mistral interrompeu a resposta.');
        if (texto) ev.fala(mascarar(texto));
      } finally {
        recebendo = false;
        await c.fechar();
      }
    } finally {
      const restaurado = await preferencias.restaurar();
      if (!restaurado)
        ev.sistema?.(
          'Mistral: config nativa alterada por outro processo; revisao manual do modelo padrao pode ser necessaria.',
        );
    }
  }
}

export function valoresAcp(opcao: any): { value: string; name?: string }[] {
  return (opcao?.options ?? [])
    .flatMap((o: any) => o.options ?? [o])
    .filter((o: any) => typeof o.value === 'string');
}
export function opcaoAcp(estado: any, categoria: string): any {
  return estado?.configOptions?.find(
    (o: any) =>
      o.category === categoria || (categoria === 'thinking' && o.category === 'thought_level'),
  );
}
