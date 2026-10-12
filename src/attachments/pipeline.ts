import { createReadStream, createWriteStream } from 'node:fs';
import { stat, mkdir, rename, unlink, writeFile, rm, lstat, realpath } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Worker } from 'node:worker_threads';
import { basename, join, resolve, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { Anexo, Configuracao } from '../shared/protocolo';
import { classificar } from './limites';
import { limitar } from '../core/configuracao';
import { caminhoReal } from '../core/seguranca';
export interface AnexoArmazenado {
  meta: Anexo;
  hash?: string;
  arquivo?: string;
  texto: string;
}
export class Anexador {
  constructor(
    private pasta: string,
    private worker: string,
    private limites: () => Configuracao['limites'],
  ) {}
  async excluirSemReferencia(
    arquivos: string[],
    referenciado: (arquivo: string) => Promise<boolean>,
  ): Promise<void> {
    for (const arquivo of arquivos) {
      // So remove objetos de conteudo da pasta gerenciada; nunca um caminho arbitrario do banco.
      if (
        !/^[a-f0-9]{64}$/.test(basename(arquivo)) ||
        resolve(dirname(arquivo)) !== resolve(this.pasta)
      )
        continue;
      if (await referenciado(arquivo)) continue;
      try {
        const info = await lstat(arquivo);
        if (
          !info.isFile() ||
          info.isSymbolicLink() ||
          resolve(dirname(await realpath(arquivo))) !== resolve(await realpath(this.pasta))
        )
          continue;
        await unlink(arquivo);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
    }
  }
  async arquivo(caminho: string, nome = basename(caminho)): Promise<AnexoArmazenado> {
    const real = await caminhoReal(caminho);
    const info = await stat(real);
    if (!info.isFile()) throw new Error('Anexo deve ser arquivo.');
    const meta: Anexo = {
      id: randomUUID(),
      nome: basename(nome).replace(/[\\/]/g, '_'),
      bytes: info.size,
      ...classificar(nome, info.size, this.limites()),
    };
    if (meta.tratamento === 'recusado') return { meta, texto: '' };
    await mkdir(this.pasta, { recursive: true });
    const tmp = join(this.pasta, randomUUID() + '.tmp');
    const hash = createHash('sha256');
    let bytes = 0;
    try {
      await pipeline(
        createReadStream(real),
        new Transform({
          transform(chunk: Buffer, _enc, cb) {
            bytes += chunk.length;
            if (bytes > info.size || bytes > 20 * 1024 * 1024)
              return cb(new Error('Anexo cresceu durante a leitura.'));
            hash.update(chunk);
            cb(null, chunk);
          },
        }),
        createWriteStream(tmp, { mode: 0o600, flags: 'wx' }),
      );
      if (bytes !== info.size) throw new Error('Anexo mudou durante a leitura.');
      const digest = hash.digest('hex'),
        destino = join(this.pasta, digest);
      await rename(tmp, destino);
      if (['imagem', 'outro'].includes(meta.tipo))
        return {
          meta,
          hash: digest,
          arquivo: destino,
          texto: `${meta.nome} (${meta.bytes} bytes, ${meta.tipo})`,
        };
      const resultado = await this.processar(destino, meta);
      if (resultado.truncado && meta.tratamento === 'integral') {
        meta.tratamento = 'amostra';
        meta.aviso = 'Texto truncado no limite de processamento.';
      }
      return { meta, hash: digest, arquivo: destino, texto: resultado.texto };
    } finally {
      await unlink(tmp).catch(() => {});
    }
  }
  async dados(nome: string, base64: string): Promise<AnexoArmazenado> {
    const bytes = Buffer.byteLength(base64, 'base64');
    const meta: Anexo = {
      id: randomUUID(),
      nome: basename(nome),
      bytes,
      ...classificar(nome, bytes, this.limites()),
    };
    if (meta.tratamento === 'recusado') return { meta, texto: '' };
    await mkdir(this.pasta, { recursive: true });
    const tmp = join(this.pasta, randomUUID() + '.upload');
    try {
      await writeFile(tmp, Buffer.from(base64, 'base64'), { mode: 0o600, flag: 'wx' });
      return await this.arquivo(tmp, nome);
    } finally {
      await unlink(tmp).catch(() => {});
    }
  }
  private async processar(
    arquivo: string,
    meta: Anexo,
  ): Promise<{ texto: string; truncado: boolean }> {
    const tmp = join(this.pasta, 'parser-' + randomUUID());
    await mkdir(tmp, { recursive: true });
    try {
      return await this.workerProcessar(arquivo, meta, tmp);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }
  private workerProcessar(
    arquivo: string,
    meta: Anexo,
    tmp: string,
  ): Promise<{ texto: string; truncado: boolean }> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(this.worker, {
        env: { ...process.env, TMPDIR: tmp, TEMP: tmp, TMP: tmp },
        workerData: { arquivo, nome: meta.nome, tipo: meta.tipo, limites: limitar(this.limites()) },
        resourceLimits: {
          maxOldGenerationSizeMb: 128,
          maxYoungGenerationSizeMb: 32,
          stackSizeMb: 4,
        },
      });
      let concluido = false;
      const terminar = (erro?: Error, resultado?: { texto: string; truncado: boolean }) => {
        if (concluido) return;
        concluido = true;
        clearTimeout(timer);
        void worker.terminate().then(() => {
          if (erro) reject(erro);
          else resolve(resultado!);
        });
      };
      const timer = setTimeout(
        () => terminar(new Error('Anexo excedeu timeout de 10 segundos.')),
        10_000,
      );
      worker.once('message', (m) => terminar(m.erro ? new Error(m.erro) : undefined, m.resultado));
      worker.once('error', (e) => terminar(e));
      worker.once('exit', (code) => {
        if (!concluido) terminar(new Error(`Parser encerrou sem resultado (${code}).`));
      });
    });
  }
}
