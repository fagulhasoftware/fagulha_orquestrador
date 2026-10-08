import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { ExecutorFerramentas } from '../src/mcp/executor';
import { normalizarAprovacao, validarArgumentos } from '../src/mcp/ferramentas';
import { Sala } from '../src/core/sala';
import { agentePadrao } from '../src/providers/tipos';
import { temporario, banco } from './apoio';

test('aprovar aceita o formato atual do Claude Code (tool_use_id) e campos futuros', () => {
  const atual = validarArgumentos('aprovar', {
    tool_name: 'Read',
    input: { file_path: 'a.txt' },
    tool_use_id: 'toolu_123',
  });
  assert.deepEqual(atual, { tool_name: 'Read', input: { file_path: 'a.txt' } });
  const futuro = validarArgumentos('aprovar', {
    tool_name: 'Read',
    input: { file_path: 'a.txt' },
    tool_use_id: 'toolu_456',
    session_id: 'x',
    permission_suggestions: [{ type: 'addRules' }],
  });
  assert.deepEqual(futuro, { tool_name: 'Read', input: { file_path: 'a.txt' } });
  assert.deepEqual(normalizarAprovacao({ toolName: 'Bash', tool_input: { command: 'ls' } }), {
    tool_name: 'Bash',
    input: { command: 'ls' },
  });
  assert.deepEqual(normalizarAprovacao({ tool_name: 'TodoWrite' }), { tool_name: 'TodoWrite', input: {} });
  assert.throws(() => normalizarAprovacao({ input: {} }));
  assert.throws(() => normalizarAprovacao({ tool_name: 'Read', input: [] }));
  assert.throws(() => normalizarAprovacao(null));
  // demais ferramentas continuam rigidas
  assert.throws(() => validarArgumentos('anexo_ler', { id: 'x', extra: 1 }));
});

test('Claude: ferramentas do Orquestrador, MCPs do usuario, internas e imagens da sala', async () => {
  const tmp = await temporario();
  try {
    const sala = new Sala('s', tmp.pasta, 'Sala', await banco(tmp.pasta));
    const agente = agentePadrao('claude', 'Claude', 'cli', 'amarelo');
    sala.registrar({
      agente,
      detectar: async () => ({ instalado: true }),
      estadoLogin: async () => 'conectado',
      login: async () => {},
      executar: async () => {},
    });
    await sala.iniciar();
    const sessoes = join(tmp.pasta, 'dados-sessoes');
    await mkdir(join(sessoes, 'chat', 'claude', 'exec'), { recursive: true });
    const imagem = join(sessoes, 'chat', 'claude', 'exec', 'imagem-0.png');
    await writeFile(imagem, Buffer.from([137, 80, 78, 71]));
    const executor = new ExecutorFerramentas(sala, [join(tmp.pasta, 'projeto')], async () => {}, sessoes);
    await mkdir(join(tmp.pasta, 'projeto'), { recursive: true });
    const sinal = new AbortController().signal;
    const aprovar = (payload: Record<string, unknown>) =>
      executor.executar('claude', 'aprovar', payload, sinal) as Promise<{ behavior: string; message?: string }>;

    sala.config.nivel = 'parcial';
    // ferramenta do Orquestrador com o formato atual do Claude Code
    assert.equal(
      (await aprovar({ tool_name: 'mcp__fagulha_orquestrador__anexo_ler', input: { id: 'abc' }, tool_use_id: 't1' })).behavior,
      'allow',
    );
    // argumento invalido em ferramenta do Orquestrador: recusa com motivo
    const invalido = await aprovar({ tool_name: 'mcp__fagulha_orquestrador__anexo_ler', input: { arquivo: 'x' }, tool_use_id: 't2' });
    assert.equal(invalido.behavior, 'deny');
    assert.match(invalido.message ?? '', /anexo_ler/);
    // ferramentas internas do CLI sao liberadas
    assert.equal((await aprovar({ tool_name: 'TodoWrite', input: { todos: [] }, tool_use_id: 't3' })).behavior, 'allow');
    // imagem preparada pela sala: leitura sem cartao no Parcial
    let pedidos = 0;
    const off = sala.observar((e) => {
      if (e.tipo === 'aprovacao') {
        pedidos++;
        queueMicrotask(() => sala.portao.responder(e.pedido.id, 'aprovar'));
      }
    });
    assert.equal((await aprovar({ tool_name: 'Read', input: { file_path: imagem }, tool_use_id: 't4' })).behavior, 'allow');
    assert.equal(pedidos, 0);
    // MCP do usuario (ex.: Figma) passa pelo Portao como sistema externo (Parcial pede aprovacao)
    assert.equal(
      (await aprovar({ tool_name: 'mcp__figma__get_file', input: { key: 'abc' }, tool_use_id: 't5' })).behavior,
      'allow',
    );
    assert.equal(pedidos, 1);
    // ferramenta desconhecida: recusa com o nome no motivo
    const desconhecida = await aprovar({ tool_name: 'FerramentaNova', input: {}, tool_use_id: 't6' });
    assert.equal(desconhecida.behavior, 'deny');
    assert.match(desconhecida.message ?? '', /FerramentaNova/);
    off();
    await sala.esperar();
  } finally {
    await tmp.limpar();
  }
});
