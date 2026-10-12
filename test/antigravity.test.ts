import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerEvento, montarArgumentos, ProvedorCli } from '../src/providers/cli';
test('Antigravity e participante proprio, sem colidir com Gemini', () => {
  const ag = new ProvedorCli('antigravity', async () => {});
  const g = new ProvedorCli('gemini', async () => {});
  assert.equal(ag.agente.nick, 'Antigravity');
  assert(ag.agente.apelidos.includes('ag'));
  assert(!g.agente.apelidos.includes('ag'));
});
test('Antigravity Total retoma sessao e recusa niveis/modos sem isolamento', () => {
  const a = montarArgumentos('antigravity', 'leitura_escrita', 'total', 'conversa');
  assert(a.includes('--dangerously-skip-permissions'));
  assert.equal(a[a.indexOf('--conversation') + 1], 'conversa');
  for (const nivel of ['manual', 'parcial'] as const)
    assert.throws(() => montarArgumentos('antigravity', 'leitura_escrita', nivel), /isolamento/);
  for (const modo of ['leitura', 'escrita'] as const)
    assert.throws(() => montarArgumentos('antigravity', modo, 'total'), /isolamento/);
});
test('Antigravity decodifica sessao, deltas, ferramentas e erro', () => {
  const eventos: string[] = [];
  const ev = {
    sessao: (v: string) => eventos.push('sessao:' + v),
    parcial: (v: string) => eventos.push('texto:' + v),
    fala: () => {},
    acao: (v: string) => eventos.push('acao:' + v),
    erro: (v: string) => eventos.push('erro:' + v),
  };
  lerEvento('antigravity', { event: 'init', conversation_id: 'c' }, ev);
  lerEvento(
    'antigravity',
    { event: 'step_update', step_update: { step_type: 'agent_response', text_delta: 'ola' } },
    ev,
  );
  lerEvento(
    'antigravity',
    { event: 'step_update', step_update: { step_type: 'tool_call', state: 'DONE' } },
    ev,
  );
  lerEvento('antigravity', { event: 'result', status: 'ERROR', error: { message: 'falhou' } }, ev);
  assert.deepEqual(eventos.slice(0, 2), ['sessao:c', 'texto:ola']);
  assert(eventos.some((v) => v.startsWith('acao:')));
  assert(eventos.includes('erro:falhou'));
});
