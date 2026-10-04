import { build } from 'esbuild-wasm';
import { existsSync } from 'node:fs';
import { mkdir, copyFile, readFile, writeFile, cp } from 'node:fs/promises';
import { resolve, dirname, extname, isAbsolute, relative } from 'node:path';
import { createRequire, builtinModules } from 'node:module';
const require = createRequire(import.meta.url);
const builtins = new Set(builtinModules.map((m) => m.replace(/^node:/, '')));
// Node resolve IO evita enumeracao de ancestrais pelo binario Go no sandbox Windows.
function resolverNode(browser = false) {
  return {
    name: 'node-io',
    setup(b) {
      b.onResolve({ filter: /.*/ }, async (args) => {
        if (args.path.startsWith('node:') || builtins.has(args.path) || args.path === 'vscode')
          return { path: args.path, external: true };
        if (args.path === 'pdfjs-dist/legacy/build/pdf.mjs')
          return { path: './pdf.mjs', external: true };
        // Transporte S3 opcional do unzipper nao participa do pipeline de arquivos locais.
        if (args.path === '@aws-sdk/client-s3') return { path: args.path, namespace: 'sem-s3' };
        const local =
          args.kind === 'entry-point' || args.path.startsWith('.') || isAbsolute(args.path);
        let arquivo;
        if (local) {
          const base = resolve(args.resolveDir || process.cwd(), args.path);
          for (const candidato of [
            base,
            base + '.ts',
            base + '.js',
            base + '.json',
            resolve(base, 'index.ts'),
            resolve(base, 'index.js'),
          ]) {
            try {
              await readFile(candidato);
              arquivo = candidato;
              break;
            } catch {}
          }
          if (!arquivo) {
            try {
              arquivo = require.resolve(base);
            } catch {}
          }
          if (!arquivo) return { errors: [{ text: `Modulo local nao encontrado: ${args.path}` }] };
        } else arquivo = require.resolve(args.path, { paths: [args.resolveDir || process.cwd()] });
        return {
          path: relative(process.cwd(), arquivo).replaceAll('\\', '/'),
          namespace: 'node-io',
        };
      });
      b.onLoad({ filter: /.*/, namespace: 'node-io' }, async (args) => ({
        // HOME abaixo pertence ao filesystem virtual Emscripten, nao ao SO do usuario.
        // Mantem o ambiente WASM funcional sem embutir um caminho pessoal aparente.
        contents: (await readFile(resolve(process.cwd(), args.path), 'utf8')).replaceAll(
          '/home/web_user',
          '/virtual-user',
        ),
        loader:
          extname(args.path) === '.ts' ? 'ts' : extname(args.path) === '.json' ? 'json' : 'js',
        resolveDir: dirname(resolve(process.cwd(), args.path)),
      }));
      b.onLoad({ filter: /.*/, namespace: 'sem-s3' }, () => ({
        contents: 'throw new Error("Transporte S3 indisponivel: somente anexos locais.");',
        loader: 'js',
      }));
    },
  };
}
async function gerar(opcoes) {
  const resultado = await build({ ...opcoes, write: false, logLevel: 'silent', metafile: true });
  for (const arquivo of resultado.outputFiles) {
    await mkdir(dirname(arquivo.path), { recursive: true });
    const inicioLicencas = arquivo.text.lastIndexOf('/*! Bundled license information:');
    if (inicioLicencas >= 0) {
      // Preserva autores/copyright/licencas. Contatos pessoais opcionais dos
      // fornecedores nao entram no VSIX; o codigo executavel nao e modificado.
      const licencas = arquivo.text
        .slice(inicioLicencas)
        .replace(
          /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi,
          '(contato omitido)',
        );
      await writeFile(arquivo.path, arquivo.text.slice(0, inicioLicencas) + licencas);
    } else await writeFile(arquivo.path, arquivo.contents);
  }
  console.info(`Gerado ${opcoes.outfile}`);
  for (const saida of Object.values(resultado.metafile.outputs))
    for (const i of saida.imports)
      if (
        i.external &&
        !i.path.startsWith('node:') &&
        !builtins.has(i.path) &&
        !['vscode', './pdf.mjs'].includes(i.path)
      )
        throw new Error(`Dependencia runtime nao bundled: ${i.path}`);
}
await mkdir('dist', { recursive: true });
const common = {
  absWorkingDir: process.cwd(),
  tsconfigRaw: JSON.parse(await readFile('tsconfig.json', 'utf8')),
  plugins: [resolverNode()],
  bundle: true,
  minify: true,
  sourcemap: false,
  legalComments: 'eof',
  platform: 'node',
  target: 'node20',
  format: 'cjs',
};
if (!process.argv.includes('--test'))
  await gerar({
    ...common,
    entryPoints: ['./src/extension.ts'],
    outfile: 'dist/extension.js',
    external: ['vscode'],
  });
await gerar({ ...common, entryPoints: ['./src/mcp/servidor.ts'], outfile: 'dist/mcp-servidor.js' });
await gerar({
  ...common,
  entryPoints: ['./src/attachments/worker.ts'],
  outfile: 'dist/anexos-worker.js',
});
await copyFile('node_modules/sql.js/dist/sql-wasm.wasm', 'dist/sql-wasm.wasm');
await gerar({
  ...common,
  format: 'esm',
  entryPoints: ['./node_modules/pdfjs-dist/legacy/build/pdf.mjs'],
  outfile: 'dist/pdf.mjs',
});
await gerar({
  ...common,
  format: 'esm',
  entryPoints: ['./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'],
  outfile: 'dist/pdf.worker.mjs',
});
await cp('node_modules/pdfjs-dist/cmaps', 'dist/pdf-assets/cmaps', { recursive: true });
await cp('node_modules/pdfjs-dist/standard_fonts', 'dist/pdf-assets/standard_fonts', {
  recursive: true,
});
if (!process.argv.includes('--test') && existsSync('src/webview/main.ts')) {
  await gerar({
    absWorkingDir: process.cwd(),
    tsconfigRaw: common.tsconfigRaw,
    plugins: [resolverNode(true)],
    bundle: true,
    sourcemap: false,
    minify: true,
    legalComments: 'eof',
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    entryPoints: ['./src/webview/main.ts'],
    outfile: resolve('dist/webview.js'),
  });
} else if (!process.argv.includes('--test')) {
  console.info('Webview ainda ausente: alvo browser adiado para a entrega do Claude.');
}
