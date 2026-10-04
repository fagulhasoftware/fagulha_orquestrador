import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { userInfo } from 'node:os';
import { writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import JSZip from 'jszip';
import { nickPadrao, configuracaoPadrao } from '../src/core/configuracao';
import { ProvedorCli } from '../src/providers/cli';
import { Sala } from '../src/core/sala';
import { temporario, banco } from './apoio';

const carregar = createRequire(resolve('package.json'));
const guarda = carregar('./scripts/verificar-privacidade.cjs') as {
  motivosConteudo(conteudo: string | Buffer, usuario?: string): string[];
  motivosArquivo(nome: string): string[];
  verificarVsix(
    arquivo: string,
    opcoes?: { usuario?: string },
  ): Promise<{
    arquivos: string[];
    violacoes: { arquivo: string; motivo: string }[];
  }>;
};
const usuarioFixture = 'usuario-do-empacotamento-fixture';
async function pacote(pasta: string, arquivos: Record<string, string | Buffer>) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types/>');
  zip.file('extension.vsixmanifest', '<PackageManifest/>');
  for (const [nome, conteudo] of Object.entries(arquivos)) zip.file(nome, conteudo);
  const arquivo = join(pasta, 'fixture.vsix');
  await writeFile(arquivo, await zip.generateAsync({ type: 'nodebuffer' }));
  return arquivo;
}

test('nick usa usuario do sistema, fallback Voce, preserva configuracao salva', async () => {
  assert.equal(
    nickPadrao(() => ' colaborador '),
    'colaborador',
  );
  assert.equal(
    nickPadrao(() => ''),
    'Voce',
  );
  assert.equal(
    nickPadrao(() => {
      throw new Error('sem usuario');
    }),
    'Voce',
  );
  let esperado = 'Voce';
  try {
    esperado = userInfo().username.trim() || 'Voce';
  } catch {}
  assert.equal(configuracaoPadrao().nick, esperado);
  const tmp = await temporario();
  try {
    const storage = await banco(tmp.pasta);
    const antiga = new Sala('sala-preservada', tmp.pasta, 'Sala', storage);
    await antiga.configurar({ nick: 'Apelido salvo pelo usuario' });
    const reaberta = new Sala('sala-preservada', tmp.pasta, 'Sala', storage);
    await reaberta.iniciar();
    assert.equal(reaberta.config.nick, 'Apelido salvo pelo usuario');
    await storage.finalizar();
  } finally {
    await tmp.limpar();
  }
});

test('Gemini possui nome publico correto e preserva aliases', () => {
  const p = new ProvedorCli('gemini', async () => {
    assert.fail('terminal proibido');
  });
  assert.equal(p.agente.nick, 'Gemini');
  assert.deepEqual(p.agente.apelidos, ['gemini', 'ag', 'antigravity']);
});

for (const conteudo of [
  String.raw`C:\Users\usuario\projeto`,
  String.raw`C:\\Users\\usuario\\projeto`,
  '/Users/colaborador/projeto',
  '/home/colaborador/projeto',
  usuarioFixture,
  'Nathan',
  'NATHA',
  'Talos',
  'PontoCerto',
  'fagulhasoftware@',
  'colaborador@example.test',
  'sk-fixture-key-nao-real-123456',
  'sk-ant-fixture-key-nao-real-123456',
  'AIzaFixtureKeyNaoReal1234567890',
  ...['ghp', 'gho', 'ghu', 'ghs', 'ghr'].map((p) => `${p}_FixtureTokenNaoReal123456`),
])
  test(`guarda detecta dado proibido (caso ${[...conteudo].length}, ${conteudo.startsWith('/') ? 'caminho' : 'texto'})`, () => {
    assert(guarda.motivosConteudo(conteudo, usuarioFixture).length > 0);
  });

test('literais de regex de mascaramento permitidos; chave real em regex nao e ignorada', () => {
  const literais = String.raw`const re = [/\bsk-[\w-]{16,}/g,/^sk-ant-[\w-]{16,}$/,/\bAIza[\w-]{20,}/g,/\bgh[pousr]_[\w]{20,}/g];`;
  assert.deepEqual(guarda.motivosConteudo(literais, usuarioFixture), []);
  assert.deepEqual(guarda.motivosConteudo('const classe = "task-list";', usuarioFixture), []);
  assert(
    guarda
      .motivosConteudo('/sk-fixture-chave-nao-real-123456/', usuarioFixture)
      .includes('possivel chave ou token'),
  );
  assert.deepEqual(guarda.motivosConteudo('x'.repeat(1_000_000), usuarioFixture), []);
});

test('guarda recusa arquivos pessoais/de desenvolvimento e somente aceita lista publica', () => {
  for (const nome of [
    'orquestra/missoes/x.md',
    'test/x.ts',
    'scripts/x.cjs',
    '.npm-cache/x',
    'node_modules/x',
    'dist/dados.sqlite',
    'dist/saida.log',
    'dist/.env',
    'dist/.env.production',
    'dist/extension.js.map',
    'media/foto-extra.png',
    'outro.txt',
  ])
    assert(guarda.motivosArquivo(`extension/${nome}`).length > 0);
  for (const nome of [
    'dist/extension.js',
    'dist/sql-wasm.wasm',
    'dist/pdf-assets/cmaps/x.bcmap',
    'media/logo.png',
    'media/logo-barra.png',
    'media/orquestra.css',
    'media/orquestra.svg',
    'package.json',
    'README.md',
    'readme.md',
    'LICENSE',
    'LICENSE.txt',
    'PRIVACIDADE.md',
    'changelog.md',
  ])
    assert.deepEqual(guarda.motivosArquivo(`extension/${nome}`), []);
});

test('VSIX limpo passa; dados pessoais em texto e binario UTF16, arquivo proibido e ZIP inseguro falham', async () => {
  const tmp = await temporario();
  try {
    const limpo = await pacote(tmp.pasta, {
      'extension/package.json': '{}',
      'extension/dist/extension.js': 'console.log("produto");',
    });
    assert.deepEqual(
      (await guarda.verificarVsix(limpo, { usuario: usuarioFixture })).violacoes,
      [],
    );
    for (const [nome, conteudo] of [
      ['extension/dist/extension.js', 'sk-fixture-chave-nao-real-123456'],
      ['extension/dist/extension.js', '/home/colaborador/projeto'],
      ['extension/media/logo.png', Buffer.from('colaborador@example.test', 'utf16le')],
      ['extension/media/logo.png', Buffer.from('colaborador@example.test', 'utf16le').swap16()],
      ['extension/test/fixture.txt', 'arquivo proibido'],
    ] as const) {
      const arquivo = await pacote(tmp.pasta, { [nome]: conteudo });
      assert(
        (await guarda.verificarVsix(arquivo, { usuario: usuarioFixture })).violacoes.length > 0,
      );
    }
    const inseguro = await pacote(tmp.pasta, { 'extension/../fora.txt': 'nunca extraido' });
    await assert.rejects(guarda.verificarVsix(inseguro, { usuario: usuarioFixture }), /inseguro/);
    const duplicado = await pacote(tmp.pasta, {
      'extension/dist/A.js': 'x',
      'extension/dist/a.js': 'y',
    });
    await assert.rejects(guarda.verificarVsix(duplicado, { usuario: usuarioFixture }), /duplicada/);
  } finally {
    await tmp.limpar();
  }
});

test('CLI da guarda reprova com codigo 1 e nao imprime segredo encontrado', async () => {
  const tmp = await temporario();
  const chave = 'sk-fixture-chave-nao-real-123456';
  try {
    const arquivo = await pacote(tmp.pasta, { 'extension/dist/extension.js': chave });
    const proc = spawn(process.execPath, [resolve('scripts/verificar-privacidade.cjs'), arquivo], {
      windowsHide: true,
    });
    let saida = '';
    proc.stdout.on('data', (b) => {
      saida += b;
    });
    proc.stderr.on('data', (b) => {
      saida += b;
    });
    const codigo = await new Promise<number | null>((r, reject) => {
      proc.once('error', reject);
      proc.once('close', r);
    });
    assert.equal(codigo, 1);
    assert.match(saida, /Privacidade reprovada/);
    assert(!saida.includes(chave));
  } finally {
    await tmp.limpar();
  }
});

test('ID oficial do publicador FagulhaSoftware e permitido; e-mail continua bloqueado', () => {
  assert.equal(guarda.motivosConteudo('"publisher": "FagulhaSoftware"', usuarioFixture).length, 0);
  assert(guarda.motivosConteudo('contato: fagulhasoftware@exemplo.com', usuarioFixture).length > 0);
});
