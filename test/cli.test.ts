import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarArgumentos, lerEvento, nomesMcp, type CliId } from '../src/providers/cli';
import type { ModoAgente, NivelPermissao } from '../src/shared/protocolo';
for (const id of ['claude', 'codex', 'gemini'] as CliId[])
  for (const modo of ['leitura', 'escrita', 'leitura_escrita'] as ModoAgente[])
    for (const nivel of ['manual', 'parcial', 'total'] as NivelPermissao[])
      test(`args ${id} ${modo} ${nivel}`, () => {
        const args = montarArgumentos(id, modo, nivel);
        const leitura = nivel === 'manual' || modo === 'leitura';
        assert(!args.includes('--dangerously-skip-permissions'));
        assert(!args.includes('--yolo'));
        if (id === 'claude') {
          assert.equal(
            args[args.indexOf('--permission-mode') + 1],
            leitura ? 'plan' : 'acceptEdits',
          );
          assert(args.includes('--strict-mcp-config'));
          assert.equal(args.includes('--tools'), nivel === 'manual');
          if (nivel === 'manual') assert.equal(args[args.indexOf('--tools') + 1], '');
          assert(!args.includes('--bare'));
          assert.equal(args.includes('--disallowedTools'), modo === 'escrita');
          assert(args.includes('mcp__fagulha_orquestrador__aprovar'));
          assert.equal(args[args.indexOf('--setting-sources') + 1], '');
        }
        if (id === 'codex') {
          assert.equal(
            args[args.indexOf('--sandbox') + 1],
            leitura ? 'read-only' : 'workspace-write',
          );
          assert.equal(args.includes('features.shell_tool=false'), nivel === 'manual');
          assert(!args.some((a) => a.includes('cli_auth_credentials_store')));
          assert(args.includes('sandbox_workspace_write.network_access=false'));
          assert(args.includes('mcp_servers.fagulha_orquestrador.enabled=true'));
          assert(args.includes('sandbox_workspace_write.writable_roots=[]'));
          assert(args.includes('sandbox_workspace_write.exclude_tmpdir_env_var=true'));
          assert(args.includes('sandbox_workspace_write.exclude_slash_tmp=true'));
          assert.equal(args.at(-1), '-');
        }
        if (id === 'gemini') {
          assert.equal(args[args.indexOf('--approval-mode') + 1], leitura ? 'plan' : 'auto_edit');
          assert(args.includes('fagulha_orquestrador'));
        }
      });
test('retomada e sandbox explicitos; nenhum token nos argumentos', () => {
  const c = montarArgumentos('codex', 'escrita', 'parcial', 'sessao-1');
  assert.deepEqual(c.slice(0, 3), ['exec', 'resume', 'sessao-1']);
  assert(c.includes('sandbox_mode="workspace-write"'));
  for (const id of ['claude', 'gemini'] as CliId[]) {
    const a = montarArgumentos(id, 'leitura', 'manual', 'sessao-2');
    assert.equal(a[a.indexOf('--resume') + 1], 'sessao-2');
  }
});
test('MCPs herdados: fallback conserva nomes e exige transporte no nivel Manual', () => {
  assert.deepEqual(
    nomesMcp('Name Command Args Env Cwd Status Auth\nherdado node - - - enabled Unsupported\n'),
    ['herdado'],
  );
  assert.deepEqual(nomesMcp('No MCP servers configured yet.'), []);
  assert.throws(() => nomesMcp('formato inesperado'));
  const args = montarArgumentos(
    'codex',
    'leitura_escrita',
    'parcial',
    undefined,
    undefined,
    undefined,
    undefined,
    [{ nome: 'herdado', enabled: true, transporte: { command: 'node', args: [] } }],
  );
  assert(args.includes('mcp_servers={"herdado"={command="node",args=[],enabled=false}}'));
  assert.throws(() =>
    montarArgumentos('codex', 'leitura', 'manual', undefined, undefined, undefined, undefined, [
      { nome: 'nome/invalido', enabled: true },
    ]),
  );
});
test('JSONL dos tres CLIs produz sessoes, falas, acoes e erros', () => {
  const eventos: string[] = [];
  const ev = {
    sessao: (t: string) => eventos.push('s:' + t),
    fala: (t: string) => eventos.push('f:' + t),
    parcial: (t: string) => eventos.push('p:' + t),
    acao: (t: string) => eventos.push('a:' + t),
    erro: (t: string) => eventos.push('e:' + t),
  };
  lerEvento('claude', { type: 'system', subtype: 'init', session_id: 'c' }, ev);
  lerEvento(
    'claude',
    {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'oi' },
          { type: 'tool_use', name: 'Read', input: { path: 'x' } },
        ],
      },
    },
    ev,
  );
  lerEvento('codex', { type: 'thread.started', thread_id: 'x' }, ev);
  lerEvento('codex', { type: 'item.completed', item: { type: 'agent_message', text: 'ola' } }, ev);
  lerEvento('gemini', { type: 'init', session_id: 'g' }, ev);
  lerEvento('gemini', { type: 'message', role: 'assistant', content: 'bom' }, ev);
  lerEvento('gemini', { type: 'error', message: 'falha' }, ev);
  assert(eventos.includes('s:c'));
  assert(eventos.includes('s:x'));
  assert(eventos.includes('s:g'));
  assert(eventos.includes('f:oi'));
  assert(eventos.includes('f:ola'));
  assert(eventos.includes('p:bom'));
  assert(eventos.includes('e:falha'));
  assert(eventos.some((s) => s.startsWith('a:usa Read')));
});
