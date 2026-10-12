import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { ambienteConta, argsConta, settingsContaClaude } from '../src/providers/autenticacao';
import { ProvedorCli } from '../src/providers/cli';
import { opcoesLogin } from '../src/providers/login';
import { temporario } from './apoio';

test('contas removem fontes de API sem alterar o ambiente original', () => {
  const original = { PATH: 'fixture', ANTHROPIC_API_KEY: 'fixture-anthropic', anthropic_auth_token: 'fixture-token', OPENAI_API_KEY: 'fixture-openai', CODEX_API_KEY: 'fixture-codex', MISTRAL_API_KEY: 'fixture-mistral', NODE_OPTIONS: 'fixture', GITHUB_TOKEN: 'fixture-mcp' };
  const limpo = ambienteConta(original);
  assert.equal(limpo.GITHUB_TOKEN, original.GITHUB_TOKEN);
  for (const k of ['ANTHROPIC_API_KEY', 'anthropic_auth_token', 'OPENAI_API_KEY', 'CODEX_API_KEY', 'MISTRAL_API_KEY', 'NODE_OPTIONS']) assert.equal(limpo[k], undefined);
  assert.equal(original.ANTHROPIC_API_KEY, 'fixture-anthropic');
  assert(!opcoesLogin('claude').some(o => o.variante === 'console'));
  assert(!opcoesLogin('codex').some(o => o.metodo === 'chave'));
  assert(opcoesLogin('anthropic').every(o => o.metodo === 'chave'));
  assert(opcoesLogin('mistral-api').every(o => o.metodo === 'chave'));
  assert(argsConta('codex').includes('forced_login_method="chatgpt"'));
  const settings = JSON.parse(settingsContaClaude);
  assert.equal(settings.apiKeyHelper, '');
  assert.equal(settings.forceLoginMethod, 'claudeai');
  assert.equal(settings.env.ANTHROPIC_AUTH_TOKEN, '');
});

for (const apiAtiva of [false, true]) test(`Claude verifica autenticacao antes da inferencia: API detectada=${apiAtiva}`, async () => {
  const tmp = await temporario();
  const antiga = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'fixture-ambient-only';
  try {
    const mock = join(tmp.pasta, 'claude.cjs'), registro = join(tmp.pasta, 'model-called.json');
    await writeFile(mock, `const fs=require('fs'),a=process.argv.slice(2);
      if(a.includes('--version')){console.log('fixture');process.exit(0);}
      if(a.includes('status')){console.log(JSON.stringify({loggedIn:true,authMethod:${apiAtiva ? "'api_key'" : "'claude.ai'"},email:'fixture@example.test'}));process.exit(0);}
      const s=JSON.parse(a[a.indexOf('--settings')+1]);
      fs.writeFileSync(${JSON.stringify(registro)},JSON.stringify({apiEnvPresent:!!process.env.ANTHROPIC_API_KEY,force:s.forceLoginMethod,helper:s.apiKeyHelper}));
      console.log(JSON.stringify({type:'assistant',message:{content:[{type:'text',text:'OK'}]}}));`);
    const p = new ProvedorCli('claude', async () => {}, mock, tmp.pasta);
    await p.detectar();
    const pedido = { prompt: 'fixture', projeto: tmp.pasta, modo: 'leitura_escrita' as const, nivel: 'total' as const, ponte: { url: 'http://127.0.0.1:1', token: 'fixture', servidor: 'fixture', diretorio: join(tmp.pasta, 'bridge') } };
    const ev = { sessao: () => {}, fala: () => {}, parcial: () => {}, acao: () => {}, erro: () => {} };
    if (apiAtiva) {
      await assert.rejects(p.executar(pedido, ev, new AbortController().signal), /Nenhuma requisicao/);
      await assert.rejects(access(registro));
    } else {
      await p.executar(pedido, ev, new AbortController().signal);
      assert.deepEqual(JSON.parse(await readFile(registro, 'utf8')), { apiEnvPresent: false, force: 'claudeai', helper: '' });
    }
    assert.equal(process.env.ANTHROPIC_API_KEY, 'fixture-ambient-only');
  } finally {
    if (antiga === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = antiga;
    await tmp.limpar();
  }
});
