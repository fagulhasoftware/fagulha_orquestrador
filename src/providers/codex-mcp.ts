import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { NivelPermissao } from '../shared/protocolo';
import { mascarar } from '../core/seguranca';

export interface McpHerdado {
  nome: string;
  enabled: boolean;
  transporte?: { command: string; args: string[] } | { url: string };
}

// Escapes Unicode para controles e escape explicito de aspas e barras Windows.
export function tomlString(valor: string): string {
  return (
    '"' +
    valor.replace(/["\\\x00-\x1f\x7f]/g, (c) =>
      c === '"'
        ? '\\"'
        : c === '\\'
          ? '\\\\'
          : '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'),
    ) +
    '"'
  );
}

const naoVazia = (v: unknown): v is string => typeof v === 'string' && !!v.trim();
const nomeValido = (v: unknown): v is string => naoVazia(v) && /^[\w.-]+$/.test(v);

function transporte(v: any): McpHerdado['transporte'] {
  if (!v || typeof v !== 'object') return undefined;
  const credenciais = [v.env, v.http_headers].flatMap((campos) =>
    campos && typeof campos === 'object'
      ? Object.values(campos).filter((valor): valor is string => naoVazia(valor))
      : [],
  );
  const seguro = (valor: string) =>
    mascarar(valor) === valor &&
    !/(?:^|\s)--?(?:api[-_]?key|access[-_]?token|token|password|secret|authorization|headers?)\b/i.test(
      valor,
    ) &&
    !credenciais.some(
      (segredo) => valor === segredo || (segredo.length >= 8 && valor.includes(segredo)),
    );
  if (
    v.type === 'stdio' &&
    naoVazia(v.command) &&
    (v.args === undefined || (Array.isArray(v.args) && v.args.every(naoVazia)))
  ) {
    if (![v.command, ...(v.args ?? [])].every(seguro)) return undefined;
    return { command: v.command, args: v.args ?? [] };
  }
  if (['streamable_http', 'http', 'sse'].includes(v.type) && naoVazia(v.url)) {
    try {
      const url = new URL(v.url);
      const segredoNaQuery = [...url.searchParams.keys()].some((chave) =>
        /token|secret|password|authorization|api[-_]?key/i.test(chave),
      );
      if (
        ['http:', 'https:'].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !url.hash &&
        !segredoNaQuery &&
        seguro(v.url)
      )
        return { url: v.url };
    } catch {
      /* transporte invalido */
    }
  }
  return undefined;
}

export function lerMcpJson(saida: string): McpHerdado[] {
  const lista: unknown = JSON.parse(saida);
  if (!Array.isArray(lista)) throw new Error('Formato de lista MCP nao reconhecido.');
  // Somente a lista permitida fica em memoria. Env, headers e tokens sao descartados.
  return lista.map((v: any) => ({
    nome: typeof v?.name === 'string' ? v.name : '(nome ausente)',
    enabled: v?.enabled !== false,
    transporte: v?.enabled === false ? undefined : transporte(v?.transport),
  }));
}

export function lerMcpTexto(tabela: string): McpHerdado[] {
  const lista: McpHerdado[] = [];
  let cabecalho = false;
  for (const linha of tabela.split(/\r?\n/)) {
    if (/^Name\s+/.test(linha)) {
      cabecalho = true;
      continue;
    }
    if (!linha.trim()) {
      cabecalho = false;
      continue;
    }
    if (!cabecalho) continue;
    const nome = linha.match(/^(\S+)\s+/)?.[1];
    if (!nome) throw new Error('Formato de lista MCP nao reconhecido.');
    // Nao tenta reconstruir command/args/URL de colunas ambiguas ou mascaradas.
    lista.push({ nome, enabled: !/\sdisabled(?:\s|$)/i.test(linha) });
  }
  if (!lista.length && !/No MCP servers configured/i.test(tabela))
    throw new Error('Nao foi possivel verificar MCPs herdados.');
  return lista;
}

export function isolamentoMcp(
  lista: McpHerdado[],
  nivel: NivelPermissao,
): {
  args: string[];
  ativos: string[];
} {
  if (nivel === 'total')
    return {
      args: [],
      ativos: lista
        .filter((m) => m.enabled && m.nome !== 'fagulha_orquestrador')
        .map((m) => m.nome),
    };
  const tabelas: string[] = [],
    ativos: string[] = [];
  for (const mcp of lista) {
    if (!mcp.enabled || mcp.nome === 'fagulha_orquestrador') continue;
    if (!nomeValido(mcp.nome) || !mcp.transporte) {
      ativos.push(mcp.nome);
      continue;
    }
    // O valor e TOML; a chave -c usa notacao de caminho. Mantem nomes com pontos
    // dentro do valor da tabela, sem depender de aspas no caminho da CLI.
    const t = mcp.transporte;
    const campos =
      'command' in t
        ? `command=${tomlString(t.command)},args=[${t.args.map(tomlString).join(',')}]`
        : `url=${tomlString(t.url)}`;
    tabelas.push(`${tomlString(mcp.nome)}={${campos},enabled=false}`);
  }
  if (ativos.length && nivel === 'manual')
    throw new Error(
      `Nao foi possivel isolar MCPs herdados do Codex: ${ativos.join(', ')}. ` +
        'Execucao recusada: o nivel Manual exige isolamento e transporte valido.',
    );
  return { args: tabelas.length ? ['-c', `mcp_servers={${tabelas.join(',')}}`] : [], ativos };
}

interface Descoberta {
  servidores: McpHerdado[];
  obsoletas: boolean;
}
const cache = new Map<string, { mtime: number | undefined; valor: Promise<Descoberta> }>();

export async function descobrirMcp(
  bin: { cmd: string; prefixo: string[] },
  env: NodeJS.ProcessEnv,
  listar: (json: boolean) => Promise<{ saida: string; obsoletas: boolean }>,
): Promise<Descoberta> {
  const config = resolve(join(env.CODEX_HOME || join(homedir(), '.codex'), 'config.toml'));
  let mtime: number | undefined;
  try {
    mtime = (await stat(config)).mtimeMs;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const chave = JSON.stringify([bin.cmd, bin.prefixo, config]);
  const anterior = cache.get(chave);
  if (anterior && anterior.mtime === mtime) return anterior.valor;
  const valor = (async () => {
    let json;
    try {
      json = await listar(true);
    } catch {
      const texto = await listar(false);
      return { servidores: lerMcpTexto(texto.saida), obsoletas: texto.obsoletas };
    }
    return { servidores: lerMcpJson(json.saida), obsoletas: json.obsoletas };
  })();
  const entrada = { mtime, valor };
  cache.set(chave, entrada);
  try {
    return await valor;
  } catch (e) {
    if (cache.get(chave) === entrada) cache.delete(chave);
    throw e;
  }
}

export const avisoConfigCodex =
  'O Codex ignorou configuracoes obsoletas no seu config.toml: ' +
  'features.rmcp_client, mcp. Isso nao afeta o Orquestrador.';

// Classifica tambem avisos multiline emitidos no stderr, sem ocultar erros reais.
export function filtroAvisoCodex(avisar: () => void): (linha: string) => boolean {
  let continuacao = false;
  return (linha) => {
    if (/^[^{]*\bCodex is ignoring \d+ unrecognized configuration settings/i.test(linha)) {
      continuacao = true;
      avisar();
      return false;
    }
    if (
      continuacao &&
      (/^\s*[-*]?\s*[`'"]?(?:features\.rmcp_client|mcp)[`'"]?\s*[,.;]?\s*$/.test(linha) ||
        !linha.trim())
    )
      return false;
    continuacao = false;
    return true;
  };
}
