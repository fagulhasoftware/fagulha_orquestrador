import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { matarArvore } from './processo';
import { mascarar } from '../core/seguranca';
import type { RecursoNativo } from '../shared/protocolo';
import { ambienteConta, argsConta } from './autenticacao';
export function iconeApp(valor: unknown): string | undefined {
  if (typeof valor !== 'string' || valor.length > 2048 || mascarar(valor) !== valor) return;
  try {
    const u = new URL(valor);
    if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) return;
    if (!['oaistatic.com', 'openai.com', 'chatgpt.com'].some((d) => u.hostname === d || u.hostname.endsWith(`.${d}`))) return;
    return u.href;
  } catch { return; }
}
// Consulta somente metadados pelo protocolo oficial; nao transfere credenciais entre agentes.
export async function appsCodex(
  bin: { cmd: string; prefixo: string[] },
  timeoutMs = 15000,
  observar?: (evento: { id: unknown; method: unknown; erro?: unknown }) => void,
): Promise<RecursoNativo[]> {
  return new Promise((resolve, reject) => {
    const p = spawn(
      bin.cmd,
      [...bin.prefixo, ...argsConta('codex'), '-c', 'features.apps=true', 'app-server', '--listen', 'stdio://'],
      {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: ambienteConta(),
      },
    );
    let encerrado = false,
      buffer = '',
      pagina = 2;
    const data: RecursoNativo[] = [];
    const vistos = new Set<string>();
    const decoder = new StringDecoder('utf8');
    const fim = (e?: Error) => {
      if (encerrado) return;
      encerrado = true;
      clearTimeout(timer);
      p.stdin.end();
      matarArvore(p.pid);
      e ? reject(e) : resolve(data);
    };
    const timer = setTimeout(
      () => fim(new Error('Catalogo nativo Codex excedeu tempo limite.')),
      timeoutMs,
    );
    p.on('error', (e) => fim(e));
    p.on('close', () => {
      if (!encerrado) fim(new Error('Codex encerrou antes de listar Apps.'));
    });
    p.stdin.on('error', () => {});
    p.stderr.resume();
    const enviar = (v: unknown) => p.stdin.write(JSON.stringify(v) + '\n');
    p.stdout.on('data', (chunk: Buffer) => {
      buffer += decoder.write(chunk);
      if (buffer.length > 32 * 1024 * 1024)
        return fim(new Error('Catalogo nativo excedeu limite.'));
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const linha = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        let j;
        try {
          j = JSON.parse(linha);
        } catch {
          continue;
        }
        observar?.({ id: j.id, method: j.method, erro: j.error?.code });
        if (j.id === 1) {
          if (j.error)
            return fim(new Error('Codex nao aceitou inicializacao de recursos nativos.'));
          enviar({ method: 'initialized' });
          enviar({ id: pagina, method: 'app/list', params: { limit: 20, forceRefetch: false } });
        } else if (j.id === pagina || (j.method === 'app/list/updated' && j.params?.data?.length)) {
          if (j.error)
            return fim(new Error('Catalogo de Apps indisponivel neste runtime/conta Codex.'));
          for (const a of j.result?.data ?? j.params?.data ?? [])
            if (
              typeof a.id === 'string' &&
              typeof a.name === 'string' &&
              (a.isAccessible === true || a.pluginDisplayNames?.length)
            )
              data.push({
                id: a.name.toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, '-'),
                nome: mascarar(a.name),
                descricao: typeof a.description === 'string' ? mascarar(a.description).slice(0, 500) : undefined,
                iconeUrl: iconeApp(a.logoUrlDark) ?? iconeApp(a.logoUrl),
                agente: 'codex',
                disponivel: a.isAccessible === true && a.isEnabled !== false,
                estado: a.isEnabled === false
                  ? 'desativado no agente'
                  : a.isAccessible
                    ? 'disponivel no agente'
                    : 'requer conexao no agente',
              });
          const c = j.result?.nextCursor;
          if (c && data.length < 1000 && !vistos.has(c)) {
            vistos.add(c);
            enviar({ id: ++pagina, method: 'app/list', params: { limit: 20, cursor: c } });
          } else fim();
        }
      }
    });
    enviar({
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: {
          name: 'fagulha_orquestrador',
          title: 'Orquestrador Fagulha',
          version: '0.4.2',
        },
        capabilities: { experimentalApi: true },
      },
    });
  });
}
