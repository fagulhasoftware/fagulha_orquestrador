// Compatibilidade do browser-client 26.623.31921 com globals protegidos do host.
// Nao instala o conector nativo, nao altera o kernel nem modifica permissoes.
const { createHash } = require('node:crypto');
const { readFile, writeFile } = require('node:fs/promises');
const { basename, resolve } = require('node:path');
const originalHash = 'd1a8040310e3ed270b3d17f6f3d41f4cdbad9096fa1a4f7c425fbb37afe949d3';
const trechoOriginal =
  '  globalThis.process = processShim;\n  globalThis.global = globalThis.global ?? globalThis;\n  globalThis.global.process = processShim;';
const trechoCorrigido =
  '  // Module-local shim: keep the host globals and protected process unchanged.\n  const process = processShim;\n  const global = Object.create(globalThis);\n  Object.defineProperty(global, "process", { value: processShim });';
function corrigirCodigo(codigo) {
  if (codigo.includes(trechoCorrigido) && !codigo.includes(trechoOriginal)) return codigo;
  if (codigo.split(trechoOriginal).length !== 2)
    throw new Error('Runtime desconhecido: nada alterado.');
  return codigo.replace(trechoOriginal, trechoCorrigido);
}
async function corrigirArquivo(caminho) {
  const destino = resolve(caminho);
  if (basename(destino) !== 'browser-client.mjs')
    throw new Error('O destino deve ser browser-client.mjs.');
  const original = await readFile(destino);
  const codigo = original.toString('utf8');
  if (corrigirCodigo(codigo) === codigo) return { alterado: false };
  if (createHash('sha256').update(original).digest('hex') !== originalHash)
    throw new Error('SHA-256 diferente da versao diagnosticada: nada alterado.');
  const backup = destino + '.antes-correcao';
  try {
    await writeFile(backup, original, { flag: 'wx' });
  } catch (e) {
    if (e.code !== 'EEXIST' || !(await readFile(backup)).equals(original)) throw e;
  }
  await writeFile(destino, corrigirCodigo(codigo), 'utf8');
  return { alterado: true, backup };
}
module.exports = { corrigirCodigo, corrigirArquivo };
if (require.main === module) {
  if (!process.argv[2]) {
    console.error(
      'Uso: node scripts/corrigir-browser-runtime.cjs <caminho-absoluto/browser-client.mjs>',
    );
    process.exitCode = 1;
  } else
    corrigirArquivo(process.argv[2])
      .then((r) => console.log(JSON.stringify(r)))
      .catch((e) => {
        console.error(e.message);
        process.exitCode = 1;
      });
}
