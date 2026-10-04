import { parentPort, workerData } from 'node:worker_threads';
import { open, readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { extname, dirname, join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import ExcelJS from 'exceljs';
import mammoth from 'mammoth';
import { parse } from 'csv-parse';
import { Open } from 'unzipper';
import type { Readable } from 'node:stream';
import type { Configuracao, Anexo } from '../shared/protocolo';
import { mascarar } from '../core/seguranca';
interface Entrada {
  arquivo: string;
  nome: string;
  tipo: Anexo['tipo'];
  limites: Configuracao['limites'];
}
export async function extrair(e: Entrada): Promise<{ texto: string; truncado: boolean }> {
  const teto = e.limites.textoIntegralKB * 1024;
  let texto = '',
    truncado = false;
  const adicionar = (s: string) => {
    const restante = teto - texto.length;
    if (s.length > restante) truncado = true;
    texto += s.slice(0, Math.max(0, restante));
  };
  if (e.tipo === 'texto') {
    const f = await open(e.arquivo, 'r');
    try {
      const b = Buffer.alloc(teto);
      const r = await f.read(b, 0, teto, 0);
      texto = b.subarray(0, r.bytesRead).toString('utf8');
      truncado = (await f.stat()).size > teto;
    } finally {
      await f.close();
    }
  } else if (e.tipo === 'docx') {
    const zip = await Open.file(e.arquivo);
    let expandido = 0;
    for (const f of zip.files.filter((f) => /\.(xml|rels)$/.test(f.path))) {
      const stream = f.stream();
      try {
        for await (const chunk of stream) {
          expandido += chunk.length;
          if (expandido > 32 * 1024 * 1024) throw new Error('DOCX expandido excede limite.');
        }
      } finally {
        stream.destroy();
      }
    }
    const resultado = await mammoth.extractRawText({ path: e.arquivo });
    adicionar(resultado.value);
  } else if (e.tipo === 'pdf') {
    const pdf = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdf.GlobalWorkerOptions.workerSrc = pathToFileURL(join(__dirname, 'pdf.worker.mjs')).href;
    const pacote = join(__dirname, 'pdf-assets');
    const tarefa = pdf.getDocument({
      data: new Uint8Array(await readFile(e.arquivo)),
      cMapUrl: join(pacote, 'cmaps') + sep,
      cMapPacked: true,
      standardFontDataUrl: join(pacote, 'standard_fonts') + sep,
      isEvalSupported: false,
      useSystemFonts: false,
      disableFontFace: true,
      verbosity: 0,
    });
    try {
      const documento = await tarefa.promise;
      for (let i = 1; i <= Math.min(documento.numPages, 50); i++) {
        const pagina = await documento.getPage(i);
        const conteudo = await pagina.getTextContent();
        adicionar(conteudo.items.map((x) => ('str' in x ? x.str : '')).join(' ') + '\n');
        pagina.cleanup();
        if (texto.length >= teto) {
          truncado = true;
          break;
        }
      }
      if (documento.numPages > 50) truncado = true;
    } finally {
      await tarefa.destroy();
    }
  } else if (e.tipo === 'planilha') {
    const ext = extname(e.nome).toLowerCase();
    if (ext === '.csv' || ext === '.tsv') {
      const stream = createReadStream(e.arquivo).pipe(
        parse({
          delimiter: ext === '.tsv' ? '\t' : ',',
          relax_column_count: true,
          bom: true,
          max_record_size: 512 * 1024,
        }),
      );
      let linhas = 0;
      try {
        for await (const row of stream) {
          if (linhas <= e.limites.planilhaLinhasPorAba) adicionar(JSON.stringify(row) + '\n');
          linhas++;
        }
      } finally {
        stream.destroy();
      }
      adicionar(`\nLinhas de dados contadas: ${Math.max(0, linhas - 1)}.\n`);
    } else {
      // ExcelJS WorkbookReader.parse() + autodrain pode perder entradas ZIP (reproduzido).
      // O indice central e pequeno; cada XML e aberto como stream independente. IO de linhas
      // continua exclusivamente com os leitores streaming do ExcelJS, sem workbook integral.
      const zip = await Open.file(e.arquivo);
      if (zip.files.reduce((s, f) => s + f.uncompressedSize, 0) > 100 * 1024 * 1024)
        throw new Error('Planilha expandida excede 100 MB.');
      const reader = new ExcelJS.stream.xlsx.WorkbookReader(e.arquivo, {
        entries: 'emit',
        sharedStrings: 'ignore',
        styles: 'ignore',
        hyperlinks: 'ignore',
        worksheets: 'emit',
      });
      const interno = reader as unknown as {
        _parseWorkbook(s: Readable): Promise<void>;
        _parseRels(s: Readable): Promise<void>;
        _parseWorksheet(
          s: AsyncIterable<Buffer>,
          id: string,
        ): Iterable<{ value: AsyncIterable<ExcelJS.Row> & { name: string } }>;
        _parseSharedStrings(s: Readable): AsyncIterable<{ index: number; text: unknown }>;
        options: { sharedStrings: string };
      };
      for (const f of zip.files)
        if (f.path === 'xl/workbook.xml') await interno._parseWorkbook(f.stream());
      for (const f of zip.files)
        if (f.path === 'xl/_rels/workbook.xml.rels') await interno._parseRels(f.stream());
      let abas = 0;
      const amostras: { nome: string; linhas: unknown[]; total: number }[] = [];
      const referencias = new Set<number>();
      const coletar = (v: unknown): void => {
        if (!v || typeof v !== 'object') return;
        if ('sharedString' in v)
          referencias.add(Number((v as { sharedString: number }).sharedString));
        else for (const x of Object.values(v)) coletar(x);
      };
      for (const f of zip.files
        .filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f.path))
        .slice(0, e.limites.planilhaAbas)) {
        abas++;
        const stream = f.stream();
        const aba = [...interno._parseWorksheet(stream, f.path.match(/sheet(\d+)/)![1])][0].value;
        let linhas = 0;
        const dados: unknown[] = [];
        try {
          for await (const row of aba) {
            if (linhas <= e.limites.planilhaLinhasPorAba) {
              dados.push(row.values);
              coletar(row.values);
            }
            linhas++;
          }
        } finally {
          stream.destroy();
        }
        amostras.push({
          nome: (aba as unknown as { name?: string }).name ?? String(abas),
          linhas: dados,
          total: linhas,
        });
      }
      // Segunda passagem streaming: guarda APENAS strings referenciadas pela amostra, nunca a tabela inteira.
      const strings = new Map<number, unknown>();
      let bytesStrings = 0;
      if (referencias.size) {
        interno.options.sharedStrings = 'emit';
        const entrada = zip.files.find((f) => f.path === 'xl/sharedStrings.xml');
        const stream = entrada?.stream();
        try {
          if (stream)
            for await (const evento of interno._parseSharedStrings(stream))
              if (referencias.has(evento.index)) {
                const s = JSON.stringify(evento.text);
                bytesStrings += Buffer.byteLength(s ?? '');
                if (bytesStrings > teto) {
                  truncado = true;
                  break;
                }
                strings.set(evento.index, evento.text);
                if (strings.size === referencias.size) break;
              }
        } finally {
          stream?.destroy();
        }
      }
      const substituir = (v: any): any =>
        v && typeof v === 'object'
          ? 'sharedString' in v
            ? (strings.get(v.sharedString) ?? '[string fora da amostra]')
            : Array.isArray(v)
              ? v.map(substituir)
              : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, substituir(x)]))
          : v;
      for (const amostra of amostras) {
        adicionar(`\nAba ${amostra.nome}\n`);
        for (const row of amostra.linhas) adicionar(JSON.stringify(substituir(row)) + '\n');
        adicionar(`Linhas contadas: ${amostra.total}.\n`);
      }
    }
    truncado = true;
  }
  return { texto: mascarar(texto), truncado };
}
if (parentPort)
  void extrair(workerData as Entrada).then(
    (resultado) => parentPort!.postMessage({ resultado }),
    (e: Error) =>
      parentPort!.postMessage({
        erro:
          'Nao foi possivel interpretar o anexo com os limites definidos: ' +
          mascarar(e.message).slice(0, 200),
      }),
  );
