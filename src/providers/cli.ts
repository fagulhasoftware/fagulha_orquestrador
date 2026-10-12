import { access, readdir, stat, mkdir, writeFile, unlink } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { Provedor, PedidoExecucao, EventosProvedor, Deteccao } from './tipos';
import { agentePadrao, type Segredos } from './tipos';
import { rodar } from './processo';
import { ambienteConta, argsConta } from './autenticacao';
import type { EstadoLogin, ModoAgente, NivelPermissao } from '../shared/protocolo';
import { mascarar, protegerSegredo } from '../core/seguranca';
import { faseFerramenta, detalheFase } from '../core/fases';
import { opcoesLogin, rodarLogin, contaMascarada, type ConfigLogin } from './login';
import {
  descobrirMcp,
  isolamentoMcp,
  lerMcpTexto,
  tomlString,
  filtroAvisoCodex,
  avisoConfigCodex,
  type McpHerdado,
} from './codex-mcp';

export type CliId = 'claude' | 'codex' | 'gemini' | 'antigravity';
export function montarArgumentos(
  id: CliId,
  modo: ModoAgente,
  nivel: NivelPermissao,
  sessao?: string,
  config = 'mcp.json',
  servidor = 'mcp-servidor.js',
  node = process.execPath,
  herdados: McpHerdado[] = [],
): string[] {
  const leitura = nivel === 'manual' || modo === 'leitura';
  if (id === 'antigravity') {
    if (nivel !== 'total' || modo !== 'leitura_escrita')
      throw new Error(
        'Antigravity requer Total e leitura_escrita: isolamento nativo de Manual, Parcial e modos restritos ainda nao comprovado.',
      );
    const args = [
      '--input-format',
      'stream-json',
      '--new-project',
      '--output-format',
      'stream-json',
      '--dangerously-skip-permissions',
    ];
    if (sessao) args.push('--conversation', sessao);
    return args;
  }
  if (id === 'claude') {
    const args = [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      leitura ? 'plan' : 'acceptEdits',
      '--permission-prompt-tool',
      'mcp__fagulha_orquestrador__aprovar',
      '--mcp-config',
      config,
    ];
    if (nivel !== 'total')
      args.push('--strict-mcp-config', '--setting-sources', '', '--disable-slash-commands');
    if (nivel === 'manual')
      args.push('--tools', '', '--allowedTools', 'mcp__fagulha_orquestrador__*');
    if (modo === 'escrita') args.push('--disallowedTools', 'Read', 'Glob', 'Grep');
    args.push(...argsConta(id));
    if (sessao) args.push('--resume', sessao);
    return args;
  }
  if (id === 'codex') {
    const total = nivel === 'total';
    const sandbox = leitura ? 'read-only' : total ? 'danger-full-access' : 'workspace-write';
    const args = sessao
      ? [
          'exec',
          'resume',
          sessao,
          '--json',
          '--skip-git-repo-check',
          '-c',
          `sandbox_mode="${sandbox}"`,
        ]
      : ['exec', '--json', '--skip-git-repo-check', '--sandbox', sandbox];
    args.push(...isolamentoMcp(herdados, nivel).args);
    args.push(...argsConta(id));
    args.push(
      '-c',
      'approval_policy="never"',
      '-c',
      `sandbox_workspace_write.network_access=${total}`,
      '-c',
      'sandbox_workspace_write.writable_roots=[]',
      '-c',
      'sandbox_workspace_write.exclude_tmpdir_env_var=true',
      '-c',
      'sandbox_workspace_write.exclude_slash_tmp=true',
      ...(!total ? ['-c', 'features.js_repl=false', '-c', 'features.multi_agent=false'] : []),
      '-c',
      `features.apps=${total}`,
      '-c',
      `web_search="${total ? 'live' : 'disabled'}"`,
      '-c',
      `project_doc_max_bytes=${total ? 65536 : 0}`,
      '-c',
      `mcp_servers.fagulha_orquestrador.command=${tomlString(node)}`,
      '-c',
      `mcp_servers.fagulha_orquestrador.args=[${tomlString(servidor)}]`,
      '-c',
      `mcp_servers.fagulha_orquestrador.env={}`,
      '-c',
      `mcp_servers.fagulha_orquestrador.enabled=true`,
      '-c',
      'mcp_servers.fagulha_orquestrador.default_tools_approval_mode="approve"',
      '-c',
      'mcp_servers.fagulha_orquestrador.tool_timeout_sec=1860',
      '-c',
      `mcp_servers.fagulha_orquestrador.env_vars=${JSON.stringify(['ORQUESTRA_BRIDGE_URL', 'ORQUESTRA_BRIDGE_TOKEN', 'ELECTRON_RUN_AS_NODE'])}`,
    );
    if (nivel === 'manual')
      args.push('-c', 'features.shell_tool=false', '-c', 'features.unified_exec=false');
    if (nivel === 'manual') args.push('-c', 'features.apply_patch_freeform=false');
    args.push('-');
    return args;
  }
  const args = [
    '-p',
    ' ',
    '--output-format',
    'stream-json',
    '--approval-mode',
    leitura ? 'plan' : 'auto_edit',
    '--allowed-mcp-server-names',
    'fagulha_orquestrador',
  ];
  if (sessao) args.push('--resume', sessao);
  return args;
}
async function existe(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}
// Compatibilidade para consumidores da antiga funcao de nomes.
export function nomesMcp(tabela: string): string[] {
  return [...new Set(lerMcpTexto(tabela).map((mcp) => mcp.nome))];
}
export async function localizar(
  id: CliId,
  configurado?: string,
): Promise<{ cmd: string; prefixo: string[] } | undefined> {
  if (configurado)
    return /\.[cm]?js$/i.test(configurado)
      ? { cmd: process.execPath, prefixo: [configurado] }
      : { cmd: configurado, prefixo: [] };
  if (id === 'claude') {
    const atual = await localizarExtensao(id);
    if (atual) return atual;
  }
  const dirs = (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':');
  if (id === 'antigravity') dirs.unshift(join(homedir(), '.gemini', 'bin'));
  if (process.platform === 'win32') dirs.unshift(join(homedir(), '.local', 'bin'));
  for (const d of dirs) {
    const exe = join(
      d,
      (id === 'antigravity' ? 'agy' : id) + (process.platform === 'win32' ? '.exe' : ''),
    );
    if (await existe(exe)) return { cmd: exe, prefixo: [] };
    if (process.platform === 'win32' && id !== 'antigravity') {
      const pacote =
        id === 'gemini'
          ? ['@google', 'gemini-cli', 'bundle', 'gemini.js']
          : id === 'codex'
            ? ['@openai', 'codex', 'bin', 'codex.js']
            : ['@anthropic-ai', 'claude-code', 'cli.js'];
      const js = join(d, 'node_modules', ...pacote);
      if (await existe(js)) return { cmd: process.execPath, prefixo: [js] };
    }
  }
  if (id === 'antigravity') return undefined;
  return localizarExtensao(id);
}
async function localizarExtensao(id: CliId): Promise<{ cmd: string; prefixo: string[] } | undefined> {
  const base = join(homedir(), '.vscode', 'extensions');
  try {
    const prefixo = id === 'claude' ? 'anthropic.claude-code-' : 'openai.chatgpt-';
    const sufixo =
      id === 'claude'
        ? ['resources', 'native-binary', process.platform === 'win32' ? 'claude.exe' : 'claude']
        : [
            'bin',
            process.platform === 'win32' ? 'windows-x86_64' : `${process.platform}-${process.arch}`,
            process.platform === 'win32' ? 'codex.exe' : 'codex',
          ];
    const candidatos = await Promise.all(
      (await readdir(base))
        .filter((n) => n.startsWith(prefixo))
        .map(async (n) => {
          const p = join(base, n, ...sufixo);
          return (await existe(p)) ? { p, t: (await stat(p)).mtimeMs } : undefined;
        }),
    );
    const p = candidatos.filter((x) => !!x).sort((a, b) => b.t - a.t)[0]?.p;
    if (p && id !== 'gemini') return { cmd: p, prefixo: [] };
  } catch {
    /* extensao nao instalada */
  }
  return undefined;
}
function resumo(v: unknown): string {
  return mascarar(JSON.stringify(v) ?? '')
    .replace(/\s+/g, ' ')
    .slice(0, 400);
}
export function lerEvento(id: CliId, j: any, ev: EventosProvedor): void {
  if (id === 'antigravity') {
    if (j.event === 'init')
      ev.sistema?.(
        `Antigravity ferramentas MCP: ${(j.init?.tools ?? []).filter((t: string) => /fagulha|navegador/.test(t)).join(', ') || 'descoberta dinamica'}`,
      );
    if (j.event === 'init' && j.conversation_id) ev.sessao(j.conversation_id);
    if (j.event === 'step_update') {
      const step = j.step_update ?? {};
      if (step.text_delta && step.step_type === 'agent_response') {
        ev.fase?.('respondendo');
        ev.parcial(step.text_delta);
      } else if (
        step.step_type &&
        !['user_input', 'checkpoint', 'agent_response'].includes(step.step_type)
      ) {
        const f = faseFerramenta(step.tool_name ?? step.step_type, {});
        ev.fase?.(f.tipo, f.detalhe);
        ev.acao(
          `Antigravity: ${resumo({ tipo: step.step_type, ferramenta: step.tool_name, estado: step.state })}`,
        );
        if (step.tool_info?.error)
          ev.sistema?.(`Antigravity ferramenta falhou: ${resumo(step.tool_info.error)}`);
      }
    }
    if (j.event === 'result' && (j.result?.status === 'ERROR' || j.status === 'ERROR' || j.error))
      ev.erro(
        mascarar(String(j.error?.message ?? j.result?.error ?? j.error ?? 'Falha Antigravity')),
      );
    return;
  }
  if (
    (id === 'claude' && j.type === 'assistant') ||
    (id === 'gemini' && j.type === 'message' && j.role === 'assistant')
  )
    ev.fase?.('respondendo');
  if (j.type === 'tool_use') {
    const f = faseFerramenta(j.tool_name ?? j.name ?? '', j.parameters ?? j.input ?? {});
    ev.fase?.(f.tipo, f.detalhe);
  }
  if (
    id === 'codex' &&
    (j.type === 'item.started' || j.type === 'item.updated' || j.type === 'item.completed')
  ) {
    const it = j.item ?? {};
    if (it.type === 'reasoning') ev.fase?.('pensando');
    else if (it.type === 'agent_message') ev.fase?.('respondendo');
    else if (it.type === 'mcp_tool_call') {
      const f = faseFerramenta(it.tool ?? '', it.arguments ?? {});
      ev.fase?.(it.status === 'completed' ? 'pensando' : f.tipo, f.detalhe);
    } else if (it.type === 'web_search') ev.fase?.('pesquisando_web', detalheFase(it.query));
    else if (it.type === 'file_change') ev.fase?.('escrevendo', detalheFase(it.changes?.[0]?.path));
    else if (it.type === 'command_execution')
      ev.fase?.(j.type === 'item.completed' ? 'pensando' : 'executando', detalheFase(it.command));
  }
  if (id === 'claude') {
    if (j.type === 'system' && j.subtype === 'init' && j.session_id) ev.sessao(j.session_id);
    if (j.type === 'assistant')
      for (const c of j.message?.content ?? []) {
        if (c.type === 'thinking') ev.fase?.('pensando');
        if (c.type === 'text' && c.text?.trim()) ev.fala(c.text);
        if (c.type === 'tool_use') {
          const f = faseFerramenta(c.name, c.input);
          ev.fase?.(f.tipo, f.detalhe);
          ev.acao(`usa ${c.name}: ${resumo(c.input)}`);
        }
      }
    if (j.type === 'result' && j.is_error) ev.erro(String(j.result ?? j.subtype));
  } else if (id === 'codex') {
    if (j.type === 'thread.started' && j.thread_id) ev.sessao(j.thread_id);
    if (j.type === 'item.started' && j.item?.type === 'command_execution')
      ev.acao(`roda: ${resumo(j.item.command)}`);
    if (j.type === 'item.completed') {
      const it = j.item ?? {};
      if (it.type === 'agent_message') ev.fala(it.text ?? '');
      else if (it.type === 'file_change') ev.acao(`altera ${resumo(it.changes)}`);
      else if (it.type === 'command_execution') ev.acao(`terminou (saida ${it.exit_code})`);
      else if (it.type === 'error') ev.erro(it.message ?? 'Falha');
    }
    if (j.type === 'turn.failed' || j.type === 'error')
      ev.erro(j.error?.message ?? j.message ?? 'Falha');
  } else {
    if (j.type === 'init' && j.session_id) ev.sessao(j.session_id);
    if (j.type === 'message' && j.role === 'assistant' && j.content) ev.parcial(j.content);
    if (j.type === 'tool_use') ev.acao(`usa ${j.tool_name}: ${resumo(j.parameters)}`);
    if (j.type === 'error' || (j.type === 'result' && j.status !== 'success'))
      ev.erro(j.error?.message ?? j.message ?? 'Falha');
  }
}
export class ProvedorCli implements Provedor {
  agente;
  autenticacao?: ConfigLogin;
  private bin?: { cmd: string; prefixo: string[] };
  constructor(
    readonly id: CliId,
    _terminal: (comando: string, args: string[], env?: NodeJS.ProcessEnv) => Promise<void>,
    private configurado?: string,
    private isolamento?: string,
    private segredos?: Segredos,
  ) {
    this.agente = agentePadrao(
      id,
      id === 'antigravity'
        ? 'Antigravity'
        : id === 'gemini'
          ? 'Gemini'
          : id === 'claude'
            ? 'Claude'
            : 'Codex',
      'cli',
      id === 'claude' ? 'amarelo' : id === 'codex' ? 'verde' : 'magenta',
      id === 'antigravity' ? ['ag', 'agy'] : [],
    );
    this.agente.suportaImagem = false; // CLIs recebem descricao; imagem binaria so APIs nesta F1.
    this.agente.opcoesLogin = opcoesLogin(id);
    if (id === 'gemini') this.agente.autenticacaoModo = 'api';
    if (segredos)
      this.autenticacao = {
        segredos,
        segredoId: `fagulha.api.${id}`,
        tipoChave: id === 'codex' ? 'openai' : id === 'gemini' ? 'gemini' : undefined,
        comando: async (args, sinal, saida, stdin) => {
          if (!this.bin) throw new Error('CLI não encontrado.');
          const env = await this.ambiente();
          // O login oficial deve representar a conta do usuário, sem chaves herdadas.
          delete env.ANTHROPIC_API_KEY;
          delete env.OPENAI_API_KEY;
          delete env.CODEX_API_KEY;
          return rodarLogin(this.bin.cmd, [...this.bin.prefixo, ...argsConta(this.id), ...args], {
            cwd: resolve('.'),
            env,
            sinal,
            saida,
            stdin,
          });
        },
      };
  }
  async detectar(): Promise<Deteccao> {
    this.bin = await localizar(this.id, this.configurado);
    if (!this.bin) return { instalado: false };
    try {
      const versao = await rodar(this.bin.cmd, [...this.bin.prefixo, '--version'], {
        timeoutMs: 15_000,
        cwd: resolve('.'),
        env: await this.ambiente(),
      });
      return {
        instalado: true,
        versao: mascarar(versao.trim().slice(0, 100)),
        caminho: this.bin.cmd,
      };
    } catch {
      return { instalado: false };
    }
  }
  async estadoLogin(sinal?: AbortSignal): Promise<EstadoLogin> {
    if (!this.bin) return 'desconectado';
    if (this.id === 'antigravity') return 'desconhecido'; // Conta compartilhada com extensao; execucao confirma autenticacao.
    // Status oficial; nao abre/inspeciona arquivos de credenciais.
    if (this.id === 'gemini') {
      const chave = await this.segredos?.get('fagulha.api.gemini');
      if (chave) {
        protegerSegredo(chave);
        this.agente.conta = `chave ...${chave.slice(-4)}`;
      }
      return chave ? 'conectado' : 'desconectado';
    }
    let capturado = '';
    try {
      const env = await this.ambiente();
      delete env.ANTHROPIC_API_KEY;
      delete env.OPENAI_API_KEY;
      delete env.CODEX_API_KEY;
      await rodar(
        this.bin.cmd,
        [
          ...this.bin.prefixo,
          ...argsConta(this.id),
          ...(this.id === 'claude' ? ['auth', 'status', '--json'] : ['login', 'status']),
        ],
        {
          timeoutMs: 15_000,
          cwd: resolve('.'),
          env,
          sinal,
          trecho: (t) => {
            capturado = (capturado + t).slice(-32_000);
          },
        },
      );
      if (this.id === 'claude') {
        const status = JSON.parse(capturado);
        if (status.loggedIn !== true || !['claude.ai', 'claudeai'].includes(status.authMethod)) {
          this.agente.conta = undefined;
          return 'desconectado';
        }
        this.agente.conta = contaMascarada(
          status.email,
          status.subscriptionType ?? status.authMethod,
        );
      } else {
        if (
          !/logged in|authenticated/i.test(capturado) ||
          /not logged in|not authenticated/i.test(capturado)
        )
          return 'desconectado';
        if (/api key/i.test(capturado)) return 'desconectado';
        this.agente.conta = 'ChatGPT';
      }
      return 'conectado';
    } catch (e) {
      this.agente.conta = undefined;
      return /not logged in|not authenticated|loggedIn.*false/i.test(capturado + String(e))
        ? 'desconectado'
        : 'desconhecido';
    }
  }
  async login(): Promise<void> {
    throw new Error('Escolha uma opção de login no painel do agente.');
  }
  private async ambiente(): Promise<NodeJS.ProcessEnv> {
    return ambienteConta();
  }
  private async cwd(): Promise<string> {
    const cwd = join(this.isolamento ?? resolve('.'), 'trabalho');
    await mkdir(cwd, { recursive: true });
    return cwd;
  }
  private readonly avisosEnv = new Set<string>();
  private readonly avisosCodex = new Map<string, Set<string>>();
  private async avisarEnv(cwd: string, sessao: string, ev: EventosProvedor): Promise<void> {
    if (this.id !== 'gemini' || this.avisosEnv.has(sessao)) return;
    // Gemini carrega .env do home mesmo com --ignore-env. Inspeciona SOMENTE existencia,
    // sem abrir o arquivo. O CLI pode carregar esses arquivos por conta propria.
    const pastas = new Set<string>([homedir()]);
    let atual = resolve(cwd);
    for (;;) {
      pastas.add(atual);
      const pai = dirname(atual);
      if (pai === atual) break;
      atual = pai;
    }
    for (const p of pastas)
      for (const nome of ['.env', join('.gemini', '.env')])
        if (await existe(join(p, nome))) {
          this.avisosEnv.add(sessao);
          ev.acao(
            'Aviso: Gemini CLI pode carregar .env automaticamente. O Orquestrador Fagulha verificou somente a existencia e nao leu nenhum arquivo .env.',
          );
          return;
        }
  }
  async executar(p: PedidoExecucao, ev: EventosProvedor, sinal: AbortSignal): Promise<void> {
    if (!this.bin) throw new Error('CLI nao encontrado.');
    if (['claude', 'codex'].includes(this.id)) {
      this.agente.login = await this.estadoLogin(sinal);
      if (this.agente.login !== 'conectado')
        throw new Error(`${this.agente.nick}: login de conta nao confirmado. Entre pela conta no painel; para chave use o participante de API separado. Nenhuma requisicao ao modelo foi enviada.`);
      ev.acao(`${this.agente.nick}: autenticacao por conta confirmada (${this.agente.conta ?? 'conta nativa'}); chaves de API herdadas isoladas.`);
    }
    // Recusar antes de escrever configuracao quando nao podemos garantir o nivel.
    if (this.id === 'antigravity') montarArgumentos(this.id, p.modo, p.nivel);
    await mkdir(p.ponte.diretorio, { recursive: true });
    const config = join(p.ponte.diretorio, 'mcp.json');
    const settings = join(p.ponte.diretorio, 'gemini-settings.json');
    try {
      const servidor = {
        command: process.execPath,
        args: [p.ponte.servidor],
        env: {
          ELECTRON_RUN_AS_NODE: '1',
          ORQUESTRA_BRIDGE_URL: '${ORQUESTRA_BRIDGE_URL}',
          ORQUESTRA_BRIDGE_TOKEN: '${ORQUESTRA_BRIDGE_TOKEN}',
        },
      };
      await writeFile(config, JSON.stringify({ mcpServers: { fagulha_orquestrador: servidor } }), {
        mode: 0o600,
      });
      const env: NodeJS.ProcessEnv = {
        ...(await this.ambiente()),
        ORQUESTRA_BRIDGE_URL: p.ponte.url,
        ORQUESTRA_BRIDGE_TOKEN: p.ponte.token,
      };
      delete env.NODE_OPTIONS;
      if (this.id === 'claude') env.MCP_TOOL_TIMEOUT = '1860000';
      delete env.CLAUDECODE;
      if (this.id === 'antigravity') {
        // Registro oficial do servidor, sem URL/token persistidos. A capacidade e herdada
        // do processo desta execucao e revogada pela sala ao encerrar.
        await rodar(
          this.bin.cmd,
          [
            ...this.bin.prefixo,
            'mcp',
            'add',
            '--env',
            'ELECTRON_RUN_AS_NODE=1',
            'fagulha_orquestrador',
            process.execPath,
            p.ponte.servidor,
          ],
          { cwd: p.ponte.diretorio, env, sinal, timeoutMs: 15000 },
        );
        const pasta = join(p.ponte.diretorio, '.agents');
        await mkdir(pasta, { recursive: true });
        await writeFile(
          join(pasta, 'mcp_config.json'),
          JSON.stringify({
            mcpServers: {
              fagulha_orquestrador: {
                command: process.execPath,
                args: [p.ponte.servidor],
                env: {
                  ELECTRON_RUN_AS_NODE: '1',
                  ORQUESTRA_BRIDGE_URL: p.ponte.url,
                  ORQUESTRA_BRIDGE_TOKEN: p.ponte.token,
                },
              },
            },
          }),
          { mode: 0o600 },
        );
        ev.acao(
          'Antigravity Total: ferramentas nativas e MCPs herdados podem agir fora do Portao. Use as ferramentas da sala para auditoria e confirmacao de operacoes externas.',
        );
      }
      if (this.id === 'gemini') {
        const chave = await this.segredos?.get('fagulha.api.gemini');
        if (!chave) throw new Error('Configure a chave do Google AI Studio no painel do agente.');
        protegerSegredo(chave);
        env.GEMINI_API_KEY = chave;
        delete env.GOOGLE_API_KEY;
        delete env.GOOGLE_GENAI_USE_VERTEXAI;
        delete env.GOOGLE_GENAI_USE_GCA;
        const tools =
          p.nivel === 'manual'
            ? {
                core: [],
                discoveryCommand: '',
                callCommand: '',
                exclude: [
                  'read_file',
                  'read_many_files',
                  'list_directory',
                  'glob',
                  'grep_search',
                  'write_file',
                  'replace',
                  'run_shell_command',
                  'web_fetch',
                  'google_web_search',
                  'save_memory',
                ],
              }
            : {
                exclude: [
                  'run_shell_command',
                  'web_fetch',
                  'google_web_search',
                  'save_memory',
                  ...(p.modo === 'escrita'
                    ? ['read_file', 'read_many_files', 'list_directory', 'glob', 'grep_search']
                    : []),
                ],
              };
        await writeFile(
          settings,
          JSON.stringify({
            mcpServers: { fagulha_orquestrador: { ...servidor, trust: true, timeout: 1860000 } },
            mcp: { allowed: ['fagulha_orquestrador'] },
            tools,
            admin: { extensions: { enabled: false }, skills: { enabled: false } },
            security: {
              enablePermanentToolApproval: false,
              auth: { selectedType: 'gemini-api-key', enforcedType: 'gemini-api-key' },
            },
            general: { enableAutoUpdate: false },
            context: {
              fileName: [],
              includeDirectoryTree: false,
              memoryBoundaryMarkers: [],
              includeDirectories: [],
            },
            hooksConfig: { enabled: false },
            skills: { enabled: false },
            telemetry: { enabled: false },
            privacy: { usageStatisticsEnabled: false },
            advanced: { ignoreLocalEnv: true },
          }),
          { mode: 0o600 },
        );
        env.GEMINI_CLI_SYSTEM_SETTINGS_PATH = settings;
        env.GEMINI_CLI_TRUST_WORKSPACE = p.nivel === 'manual' ? 'false' : 'true';
      }
      const cwd =
        this.id === 'antigravity'
          ? p.ponte.diretorio
          : p.nivel === 'manual'
            ? this.isolamento
              ? await this.cwd()
              : p.ponte.diretorio
            : p.projeto;
      await mkdir(cwd, { recursive: true });
      await this.avisarEnv(cwd, p.sessao ?? 'nova', ev);
      let avisos = this.avisosCodex.get(p.sessao ?? '') ?? new Set<string>();
      const chaveSessao = p.sessao ?? randomUUID();
      this.avisosCodex.set(chaveSessao, avisos);
      const avisar = (tipo: string, texto: string) => {
        if (avisos.has(tipo)) return;
        avisos.add(tipo);
        (ev.sistema ?? ev.acao)(mascarar(texto));
      };
      const avisarConfig = () => avisar('config', avisoConfigCodex);
      let herdados: McpHerdado[] = [];
      if (this.id === 'codex') {
        try {
          let obsoletas = false;
          const descoberta = await descobrirMcp(this.bin, env, async (json) => {
            const saida = await rodar(
              this.bin!.cmd,
              [...this.bin!.prefixo, 'mcp', 'list', ...(json ? ['--json'] : [])],
              {
                cwd,
                env,
                sinal,
                timeoutMs: 15_000,
                filtrarLinha: filtroAvisoCodex(() => {
                  obsoletas = true;
                  avisarConfig();
                }),
              },
            );
            return { saida, obsoletas };
          });
          herdados = descoberta.servidores;
          if (descoberta.obsoletas) avisarConfig();
        } catch {
          if (sinal.aborted) throw new Error('Execucao interrompida.');
          if (p.nivel === 'manual')
            throw new Error(
              'Nao foi possivel verificar MCPs herdados do Codex. Execucao recusada: o nivel Manual exige isolamento.',
            );
          avisar(
            'mcp',
            'Aviso: nao foi possivel listar MCPs herdados do Codex; servidores de nomes desconhecidos podem continuar ativos nesta sessao.',
          );
        }
        const { ativos } = isolamentoMcp(herdados, p.nivel);
        if (ativos.length)
          avisar(
            'mcp',
            p.nivel === 'total'
              ? `Total: MCPs herdados ativos (${ativos.join(', ')}). Chamadas diretas nao passam pela confirmacao do Orquestrador; use comando_executar para operacoes irreversiveis externas.`
              : `Aviso: os MCPs herdados do Codex ${ativos.join(', ')} podem continuar ativos nesta sessao porque seu transporte nao pode ser isolado com seguranca.`,
          );
      }
      const args = montarArgumentos(
        this.id,
        p.modo,
        p.nivel,
        p.sessao,
        config,
        p.ponte.servidor,
        process.execPath,
        herdados,
      );
      if (this.id === 'antigravity')
        args.push('--add-dir', p.projeto, '--add-dir', p.ponte.diretorio);
      if (this.id === 'codex' && p.nivel !== 'manual')
        for (const caminho of p.caminhosImagens ?? [])
          args.splice(args.length - 1, 0, '-i', caminho);
      await rodar(this.bin.cmd, [...this.bin.prefixo, ...args], {
        cwd,
        env,
        stdin:
          this.id === 'antigravity'
            ? JSON.stringify({ event: 'user', message: { content: p.prompt } }) + '\n'
            : this.id === 'gemini' && p.nivel !== 'manual' && p.caminhosImagens?.length
              ? `${p.prompt}\nImagens da mensagem: ${p.caminhosImagens.map((c) => `@${JSON.stringify(c)}`).join(' ')}`
              : p.prompt,
        sinal,
        timeoutMs: 0, // Sala aplica tempo ativo; perguntar_usuario pode esperar 30 minutos.
        filtrarLinha: this.id === 'codex' ? filtroAvisoCodex(avisarConfig) : undefined,
        linha: (l) => {
          if (l.trim().startsWith('{')) {
            let j;
            try {
              j = JSON.parse(l);
            } catch {
              return;
            }
            lerEvento(this.id, j, {
              ...ev,
              erro: (texto) => {
                if (this.id === 'codex' && !filtroAvisoCodex(avisarConfig)(texto)) return;
                ev.erro(texto);
              },
              sessao: (id) => {
                if (this.avisosEnv.delete('nova')) this.avisosEnv.add(id);
                if (this.id === 'codex') {
                  const anteriores = this.avisosCodex.get(id);
                  if (anteriores) for (const tipo of avisos) anteriores.add(tipo);
                  avisos = anteriores ?? avisos;
                  this.avisosCodex.delete(chaveSessao);
                  this.avisosCodex.set(id, avisos);
                }
                ev.sessao(id);
              },
            });
            if (
              this.id === 'antigravity' &&
              j.event === 'result' &&
              j.result?.status === 'SUCCESS'
            ) {
              this.agente.login = 'conectado';
              this.agente.conta = 'Conta Antigravity';
            }
          }
        },
      });
    } finally {
      for (const arquivo of [
        config,
        settings,
        ...(this.id === 'antigravity'
          ? [join(p.ponte.diretorio, '.agents', 'mcp_config.json')]
          : []),
      ])
        await unlink(arquivo).catch((e) => {
          if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        });
    }
  }
}
