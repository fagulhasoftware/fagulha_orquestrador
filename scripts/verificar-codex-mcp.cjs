const assert = require('node:assert/strict');
const { mkdir, mkdtemp, writeFile, rm } = require('node:fs/promises');
const { join, resolve, sep } = require('node:path');
const { localizar, montarArgumentos } = require('../test/.tmp/build/src/providers/cli.js');
const { rodar } = require('../test/.tmp/build/src/providers/processo.js');
async function main() {
  const bin = await localizar('codex');
  if (!bin) throw new Error('Codex indisponivel.');
  const base = resolve('test/.tmp');
  await mkdir(base, { recursive: true });
  const pasta = await mkdtemp(join(base, 'mcp-probe-'));
  try {
    // Perfil sintetico SOMENTE para um diagnostico sem modelo e sem login.
    // As execucoes da Orquestrador Fagulha e o smoke de login usam o perfil real.
    await writeFile(
      join(pasta, 'config.toml'),
      '[mcp_servers.herdado_teste]\ncommand="node"\nargs=["inexistente.js"]\n',
    );
    const env = { ...process.env, CODEX_HOME: pasta, ELECTRON_RUN_AS_NODE: '1' };
    delete env.NODE_OPTIONS;
    const listar = async (args) =>
      JSON.parse(
        await rodar(bin.cmd, [...bin.prefixo, ...args, 'mcp', 'list', '--json'], {
          env,
          cwd: pasta,
          timeoutMs: 15000,
        }),
      );
    const vazio = await listar(['-c', 'mcp_servers={}']);
    assert(vazio.some((s) => s.name === 'herdado_teste' && s.enabled));
    const montagem = montarArgumentos(
      'codex',
      'leitura_escrita',
      'parcial',
      undefined,
      undefined,
      resolve('dist/mcp-servidor.js'),
      process.execPath,
      ['herdado_teste'],
    );
    const overrides = [];
    for (let i = 0; i < montagem.length; i++)
      if (montagem[i] === '-c') overrides.push('-c', montagem[++i]);
    const resultado = await listar(overrides);
    assert.equal(resultado.find((s) => s.name === 'herdado_teste')?.enabled, false);
    assert.equal(resultado.find((s) => s.name === 'fagulha_orquestrador')?.enabled, true);
    console.log(
      'Codex MCP empirico: mcp_servers={} preserva herdado; enabled=false desativa herdado; Orquestrador Fagulha permanece habilitado. Sem prompt, sem login, sem iniciar servidores.',
    );
  } finally {
    assert(pasta.startsWith(base + sep));
    await rm(pasta, { recursive: true, force: true });
  }
}
main().catch(() => {
  console.error('Verificacao MCP falhou.');
  process.exitCode = 1;
});
