const { spawn } = require('node:child_process');
const { resolve } = require('node:path');
const { name, version } = require('../package.json');

const processo = spawn(
  process.execPath,
  [
    require.resolve('@vscode/vsce/vsce'),
    'package',
    '--allow-missing-repository',
    '--out',
    `${name}-${version}.vsix`,
  ],
  { cwd: resolve(__dirname, '..'), stdio: 'inherit', windowsHide: true },
);
processo.once('error', (erro) => {
  console.error(erro.message);
  process.exitCode = 1;
});
processo.once('exit', (codigo) => {
  process.exitCode = codigo ?? 1;
});
