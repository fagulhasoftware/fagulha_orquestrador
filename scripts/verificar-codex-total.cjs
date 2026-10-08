const http = require('node:http');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { montarArgumentos, localizar } = require('../test/.tmp/build/src/providers/cli.js');
(async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'fagulha-codex-tools-'));
  let recebido = false;
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const names = (body.tools || []).map((t) => t.name || t.type);
    console.log(JSON.stringify({ tools: names }));
    recebido = true;
    if (names.some((n) => /^(shell|exec_command|write_stdin|local_shell)$/.test(n)))
      process.exitCode = 1;
    if (!names.includes('web_search')) process.exitCode = 1;
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({ error: { message: 'Validacao local encerrada, sem modelo ou cobranca.' } }),
    );
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const total = montarArgumentos('codex', 'leitura_escrita', 'total');
  const args = [];
  for (let i = 0; i < total.length - 1; i++) {
    if (total[i] === '-c' && total[i + 1].startsWith('mcp_servers.')) {
      i++;
      continue;
    }
    args.push(total[i]);
  }
  args.push(
    '-c',
    'model_provider="mock"',
    '-c',
    'model="gpt-5.4"',
    '-c',
    `model_providers.mock={name="Local",base_url="http://127.0.0.1:${server.address().port}/v1",wire_api="responses",requires_openai_auth=false,request_max_retries=0}`,
    'Validacao local.',
  );
  const bin = process.argv[2] ? { cmd: process.argv[2], prefixo: [] } : await localizar('codex');
  if (!bin) {
    server.close();
    throw new Error('Codex CLI nao encontrado.');
  }
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !/KEY|TOKEN|SECRET|PASSWORD|AUTH/i.test(k)),
  );
  const child = spawn(bin.cmd, [...bin.prefixo, ...args], {
    env: { ...env, CODEX_HOME: home },
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let err = '';
  child.stderr.on('data', (b) => (err += b));
  const timer = setTimeout(() => child.kill(), 20000);
  await new Promise((r, j) => {
    child.on('close', r);
    child.on('error', j);
  });
  clearTimeout(timer);
  server.close();
  if (!recebido) {
    console.log(err.slice(-2500));
    process.exitCode = 1;
  }
  console.log('Modelo local de validacao; nenhuma chamada paga.');
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
