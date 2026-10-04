import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { writeFile, stat } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { classificar } from '../src/attachments/limites';
import { Anexador } from '../src/attachments/pipeline';
import { limitesMaximos } from '../src/core/configuracao';
import { temporario } from './apoio';
test('planilha >5MB recusada; <=5MB sempre amostra', () => {
  assert.equal(classificar('dados.xlsx', 5 * 1024 * 1024 + 1).tratamento, 'recusado');
  assert.equal(classificar('dados.xlsx', 5 * 1024 * 1024).tratamento, 'amostra');
  assert.equal(classificar('dados.xlsx', 10).tratamento, 'amostra');
  assert.equal(classificar('dados.csv', 512 * 1024).tipo, 'texto');
  assert.equal(classificar('dados.csv', 512 * 1024 + 1).tipo, 'planilha');
  assert.equal(classificar('dados.tsv', 10).tipo, 'planilha');
  assert.equal(classificar('dados.xls', 10).tratamento, 'recusado');
});
test('limites configuraveis nao ultrapassam maximos rigidos', () => {
  assert.equal(
    classificar('arquivo.xlsx', 6 * 1024 * 1024, { planilhaMaxMB: 500 }).tratamento,
    'recusado',
  );
  assert.equal(classificar('arquivo.pdf', 21 * 1024 * 1024).tratamento, 'recusado');
  assert.equal(classificar('arquivo.png', 11 * 1024 * 1024).tratamento, 'recusado');
  assert.equal(classificar('arquivo.txt', 513 * 1024).tratamento, 'amostra');
  assert.equal(classificar('arquivo.bin', 100).tratamento, 'metadados');
});
test('pipeline real CSV e XLSX: cabecalho + 50 linhas, strings reais e contagem', async () => {
  const tmp = await temporario();
  try {
    const anexador = new Anexador(
      join(tmp.pasta, 'anexos'),
      resolve('dist/anexos-worker.js'),
      () => ({ ...limitesMaximos }),
    );
    const csv = join(tmp.pasta, 'amostra.tsv');
    await writeFile(
      csv,
      'nome\tvalor\n' + Array.from({ length: 100 }, (_, i) => `pessoa-${i}\t${i}`).join('\n'),
    );
    const r = await anexador.arquivo(csv);
    assert.equal(r.meta.tratamento, 'amostra');
    assert(r.texto.includes('pessoa-49'));
    assert(!r.texto.includes('pessoa-50'));
    assert(r.texto.includes('100'));
    assert(r.hash);
    const xlsx = join(tmp.pasta, 'amostra.xlsx');
    const writer = new ExcelJS.stream.xlsx.WorkbookWriter({
      filename: xlsx,
      useSharedStrings: true,
    });
    const aba = writer.addWorksheet('Dados');
    aba.addRow(['cabecalho', 'valor']).commit();
    for (let i = 0; i < 90; i++) aba.addRow([`linha-${i}`, i]).commit();
    await writer.commit();
    for (let i = 0; i < 3; i++) {
      const excel = await anexador.arquivo(xlsx);
      assert.equal(excel.meta.tratamento, 'amostra');
      assert(excel.texto.includes('cabecalho'), excel.texto);
      assert(excel.texto.includes('linha-49'));
      assert(!excel.texto.includes('linha-50'));
      assert(excel.texto.includes('91'));
    }
  } finally {
    await tmp.limpar();
  }
});
test('DOCX e PDF validos extraem texto em worker', async () => {
  const tmp = await temporario();
  try {
    const anexador = new Anexador(
      join(tmp.pasta, 'anexos'),
      resolve('dist/anexos-worker.js'),
      () => ({ ...limitesMaximos }),
    );
    const zip = new JSZip();
    zip.file(
      '[Content_Types].xml',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    );
    zip.file(
      '_rels/.rels',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    );
    zip.file(
      'word/document.xml',
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Documento Orquestrador Fagulha</w:t></w:r></w:p></w:body></w:document>',
    );
    const docx = join(tmp.pasta, 'documento.docx');
    await writeFile(docx, await zip.generateAsync({ type: 'nodebuffer' }));
    const doc = await anexador.arquivo(docx);
    assert(doc.texto.includes('Documento Orquestrador Fagulha'));
    const conteudo = 'BT /F1 12 Tf 10 30 Td (PDF Orquestrador Fagulha) Tj ET';
    const objs = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      `<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream`,
    ];
    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    for (const [i, obj] of objs.entries()) {
      offsets.push(Buffer.byteLength(pdf));
      pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
    }
    const xref = Buffer.byteLength(pdf);
    pdf +=
      'xref\n0 6\n0000000000 65535 f \n' +
      offsets
        .slice(1)
        .map((o) => String(o).padStart(10, '0') + ' 00000 n \n')
        .join('') +
      `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const caminho = join(tmp.pasta, 'documento.pdf');
    await writeFile(caminho, pdf);
    const p = await anexador.arquivo(caminho);
    assert(p.texto.includes('PDF Orquestrador Fagulha'));
  } finally {
    await tmp.limpar();
  }
});
test('anexo grande recusado sem copia; texto truncado e imagem aceita', async () => {
  const tmp = await temporario();
  try {
    const anexador = new Anexador(
      join(tmp.pasta, 'anexos'),
      resolve('dist/anexos-worker.js'),
      () => ({ ...limitesMaximos }),
    );
    const grande = join(tmp.pasta, 'grande.xlsx');
    await writeFile(grande, Buffer.alloc(5 * 1024 * 1024 + 1));
    const r = await anexador.arquivo(grande);
    assert.equal(r.meta.tratamento, 'recusado');
    assert.equal(r.arquivo, undefined);
    await assert.rejects(stat(join(tmp.pasta, 'anexos')));
    const txt = await anexador.dados(
      'codigo.txt',
      Buffer.from('a'.repeat(600 * 1024)).toString('base64'),
    );
    assert.equal(txt.meta.tratamento, 'amostra');
    assert.equal(txt.texto.length, 512 * 1024);
    const img = await anexador.dados(
      'imagem.png',
      Buffer.from('fake image fixture').toString('base64'),
    );
    assert.equal(img.meta.tipo, 'imagem');
    assert(img.arquivo);
    const pdf = join(tmp.pasta, 'corrompido.pdf');
    await writeFile(pdf, 'PDF invalido');
    await assert.rejects(anexador.arquivo(pdf), /interpretar/);
  } finally {
    await tmp.limpar();
  }
});
