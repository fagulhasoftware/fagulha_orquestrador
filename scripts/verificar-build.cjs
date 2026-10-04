const { spawn } = require('node:child_process');
const { mkdir, open, readFile } = require('node:fs/promises');
async function executar(saida) {
  await new Promise((resolve, reject) => {
    const filho = spawn(process.execPath, ['esbuild.mjs', '--test'], {
      stdio: ['ignore', saida, 'pipe'],
      windowsHide: true,
    });
    let erro = '';
    filho.stderr.on('data', (chunk) => {
      erro += chunk;
    });
    filho.once('error', reject);
    filho.once('close', (code) => (code === 0 ? resolve() : reject(new Error(erro))));
  });
}
async function main() {
  await mkdir('test/.tmp', { recursive: true });
  const caminho = 'test/.tmp/build-redirecionado-real.txt';
  const arquivo = await open(caminho, 'w');
  try {
    await executar(arquivo.fd);
  } finally {
    await arquivo.close();
  }
  if (!(await readFile(caminho, 'utf8')).includes('Gerado dist/anexos-worker.js'))
    throw new Error('Build nao gerou worker.');
  await executar('ignore');
  console.log(
    'Build aprovado com stdout ligado diretamente a arquivo e a NUL/dev-null, sem pipe intermediario.',
  );
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
