const { Open } = require('unzipper');
const { mkdir, mkdtemp, rm, readFile, stat, writeFile } = require('node:fs/promises');
const { join, resolve, sep } = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');
const { name, version } = require('../package.json');
async function main() {
  const base = resolve('test/.tmp');
  await mkdir(base, { recursive: true });
  const tmp = await mkdtemp(join(base, 'vsix-'));
  const arquivoVsix = resolve(`${name}-${version}.vsix`);
  const zip = await Open.file(arquivoVsix);
  const nomes = new Set(zip.files.map((f) => f.path));
  assert((await stat(arquivoVsix)).size < 5 * 1024 * 1024, 'VSIX excede 5 MB');
  assert(![...nomes].some((n) => n.includes('/node_modules/')), 'node_modules incluido no VSIX');
  for (const f of [
    'dist/extension.js',
    'dist/webview.js',
    'dist/mcp-servidor.js',
    'dist/anexos-worker.js',
    'dist/sql-wasm.wasm',
    'dist/pdf.mjs',
    'dist/pdf.worker.mjs',
    'media/orquestra.css',
    'media/orquestra.svg',
    'media/logo.png',
    'media/logo-barra.png',
  ])
    assert(nomes.has('extension/' + f), 'Recurso ausente: ' + f);
  assert(
    ![...nomes].some((n) => /\.(node|env)$/.test(n)),
    'Dependencia nativa ou arquivo protegido incluido',
  );
  try {
    await zip.extract({ path: tmp });
    const raiz = join(tmp, 'extension');
    const original = Module._load,
      resolver = Module._resolveFilename;
    const builtins = new Set(Module.builtinModules.map((m) => m.replace(/^node:/, '')));
    Module._load = function (request, parent, isMain) {
      if (request === 'vscode') return {};
      return original.apply(this, arguments);
    };
    Module._resolveFilename = function (request, parent, isMain, options) {
      const resultado = resolver.apply(this, arguments);
      if (parent?.filename?.startsWith(raiz + sep) && !builtins.has(request.replace(/^node:/, '')))
        assert(resultado.startsWith(raiz + sep), 'Dependencia escapou do VSIX: ' + request);
      return resultado;
    };
    try {
      const host = require(join(raiz, 'dist/extension.js'));
      assert.equal(typeof host.activate, 'function');
      assert.equal(typeof host.deactivate, 'function');
      const db = new host.Armazenamento(
        join(tmp, 'smoke.sqlite'),
        join(raiz, 'dist/sql-wasm.wasm'),
      );
      await db.iniciar();
      await db.gravar('mensagens', 'smoke', 'prova', { texto: 'ok' });
      assert.equal((await db.listar('mensagens', 'smoke')).length, 1);
      const { extrair } = require(join(raiz, 'dist/anexos-worker.js'));
      const tsv = join(tmp, 'smoke.tsv');
      await writeFile(tsv, 'nome\tvalor\nOrquestrador Fagulha\t1');
      const limites = { textoIntegralKB: 512, planilhaLinhasPorAba: 50, planilhaAbas: 5 };
      assert(
        (
          await extrair({ arquivo: tsv, nome: 'smoke.tsv', tipo: 'planilha', limites })
        ).texto.includes('Orquestrador Fagulha'),
      );
      const texto = 'BT /F1 12 Tf 10 30 Td (PDF Empacotado) Tj ET';
      const objetos = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        `<< /Length ${texto.length} >>\nstream\n${texto}\nendstream`,
      ];
      let pdf = '%PDF-1.4\n';
      const offsets = [];
      for (const [i, objeto] of objetos.entries()) {
        offsets.push(Buffer.byteLength(pdf));
        pdf += `${i + 1} 0 obj\n${objeto}\nendobj\n`;
      }
      const xref = Buffer.byteLength(pdf);
      pdf +=
        'xref\n0 6\n0000000000 65535 f \n' +
        offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('') +
        `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
      const caminhoPdf = join(tmp, 'smoke.pdf');
      await writeFile(caminhoPdf, pdf);
      assert(
        (
          await extrair({ arquivo: caminhoPdf, nome: 'smoke.pdf', tipo: 'pdf', limites })
        ).texto.includes('PDF Empacotado'),
      );
      const pacote = JSON.parse(await readFile(join(raiz, 'package.json'), 'utf8'));
      assert.equal(pacote.name, 'orquestrador-fagulha');
      assert.equal(pacote.displayName, 'Orquestrador Fagulha');
      assert.equal(pacote.publisher, 'fagulha');
      assert.equal(pacote.icon, 'media/logo.png');
      assert.equal(pacote.contributes.viewsContainers.activitybar[0].icon, 'media/logo-barra.png');
      assert.equal(pacote.contributes.views.fagulha[0].id, 'fagulha.sala');
    } finally {
      Module._load = original;
      Module._resolveFilename = resolver;
    }
    console.log(
      'VSIX validado: <5 MB, sem node_modules, host/SQLite WASM/TSV/PDF reais com dependencias contidas no pacote; nenhuma instalacao.',
    );
  } finally {
    assert(tmp.startsWith(base + sep));
    await rm(tmp, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e.stack ?? e.message);
  process.exitCode = 1;
});
