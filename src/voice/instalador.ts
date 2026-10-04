import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, stat, rm, rename, mkdtemp, readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Open } from 'unzipper';
import type { ProgressoInstalacaoVoz } from '../shared/protocolo';
import type { ArtefatoVoz } from './catalogo';

const hosts = new Set([
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'huggingface.co',
  'cdn-lfs.huggingface.co',
  'cdn-lfs-us-1.hf.co',
  'cdn-lfs-eu-1.hf.co',
  'cas-bridge.xethub.hf.co',
  'us.aws.cdn.hf.co',
  'eu.aws.cdn.hf.co',
]);
export function validarDownload(url: string): URL {
  const u = new URL(url);
  if (
    u.protocol !== 'https:' ||
    !hosts.has(u.hostname) ||
    u.username ||
    u.password ||
    (u.port && u.port !== '443')
  )
    throw new Error('Origem do download de voz não permitida.');
  return u;
}
export async function hashArquivo(arquivo: string, sinal?: AbortSignal): Promise<string> {
  const hash = createHash('sha256');
  for await (const parte of createReadStream(arquivo)) {
    if (sinal?.aborted) throw new Error('Instalação cancelada.');
    hash.update(parte);
  }
  return hash.digest('hex');
}
export async function extrairBinarios(
  arquivo: string,
  destino: string,
  componente: string,
  sinal?: AbortSignal,
): Promise<void> {
  const zip = await Open.file(arquivo);
  if (zip.files.length > 300) throw new Error('ZIP de voz excede o limite de arquivos.');
  const nomes = new Set<string>();
  const selecionados = [];
  for (const f of zip.files) {
    const caminho = f.path.replaceAll('\\', '/');
    if (
      !caminho ||
      caminho.startsWith('/') ||
      caminho.includes(':') ||
      caminho.split('/').includes('..') ||
      caminho.includes('\0') ||
      ((f.externalFileAttributes >>> 16) & 0xf000) === 0xa000
    )
      throw new Error('ZIP de voz contém um caminho inseguro.');
    const nome = basename(caminho);
    const permitido =
      componente === 'ffmpeg'
        ? /(?:^|\/)bin\/ffmpeg\.exe$/i.test(caminho)
        : /^Release\/(?:whisper-cli\.exe|whisper\.dll|ggml\.dll|ggml-base\.dll|ggml-cpu-(?:alderlake|cannonlake|cascadelake|haswell|icelake|sandybridge|skylakex|sse42|x64)\.dll)$/i.test(
            caminho,
          );
    if (!permitido || f.type !== 'File') continue;
    if (nomes.has(nome.toLowerCase()) || f.uncompressedSize > 200 * 1024 * 1024)
      throw new Error('ZIP de voz inválido ou grande demais.');
    nomes.add(nome.toLowerCase());
    selecionados.push(f);
  }
  const executavel = componente === 'ffmpeg' ? 'ffmpeg.exe' : 'whisper-cli.exe';
  if (!nomes.has(executavel)) throw new Error('Executável de voz ausente no ZIP.');
  await mkdir(destino, { recursive: true, mode: 0o700 });
  for (const f of selecionados) {
    if (sinal?.aborted) throw new Error('Instalação cancelada.');
    let bytes = 0;
    const limite = new Transform({
      transform(parte, _encoding, cb) {
        bytes += parte.length;
        cb(
          bytes > f.uncompressedSize ? new Error('ZIP excedeu o tamanho declarado.') : null,
          parte,
        );
      },
    });
    await pipeline(
      f.stream(),
      limite,
      createWriteStream(join(destino, basename(f.path)), { flags: 'wx', mode: 0o700 }),
      { signal: sinal },
    );
    if (bytes !== f.uncompressedSize) throw new Error('Arquivo incompleto no ZIP de voz.');
  }
}
export class InstaladorVoz {
  private controle?: AbortController;
  private tarefa?: Promise<void>;
  constructor(
    readonly pasta: string,
    private emitir: (p: ProgressoInstalacaoVoz) => void,
    private politica: (url: string) => URL = validarDownload,
  ) {}
  cancelar(): void {
    this.controle?.abort();
  }
  async finalizar(): Promise<void> {
    this.cancelar();
    await this.tarefa;
  }
  instalar(itens: ArtefatoVoz[]): Promise<void> {
    if (this.tarefa) throw new Error('Já existe uma instalação de voz em andamento.');
    const controle = new AbortController();
    this.controle = controle;
    this.tarefa = this.instalarSelecionados(itens, controle.signal).finally(() => {
      this.tarefa = undefined;
      this.controle = undefined;
    });
    return this.tarefa;
  }
  private async instalarSelecionados(itens: ArtefatoVoz[], sinal: AbortSignal): Promise<void> {
    for (const item of itens) {
      if (sinal.aborted) break;
      try {
        await this.baixar(item, sinal);
        this.emitir({
          componente: item.componente,
          etapa: 'concluido',
          mensagem: 'Componente instalado.',
        });
      } catch (e) {
        this.emitir({
          componente: item.componente,
          etapa: sinal.aborted ? 'cancelado' : 'erro',
          mensagem: sinal.aborted
            ? 'Instalação cancelada. O download pode ser retomado.'
            : e instanceof TypeError
              ? 'Não foi possível baixar o componente. Verifique sua conexão.'
              : (e as Error).name === 'TimeoutError'
                ? 'O download excedeu o tempo limite. Tente novamente.'
                : (e as Error).message,
        });
        break;
      }
    }
  }
  private async baixar(item: ArtefatoVoz, sinal: AbortSignal): Promise<void> {
    const cache = join(this.pasta, 'downloads');
    await mkdir(cache, { recursive: true, mode: 0o700 });
    if (!/^[a-z0-9.-]+$/i.test(item.arquivo)) throw new Error('Nome de artefato inválido.');
    const parcial = join(cache, item.arquivo + '.parcial');
    let offset = await stat(parcial).then(
      (s) => s.size,
      () => 0,
    );
    if (offset > item.tamanhoBytes) {
      await rm(parcial, { force: true });
      offset = 0;
    }
    this.emitir({
      componente: item.componente,
      etapa: 'baixando',
      baixadoBytes: offset,
      totalBytes: item.tamanhoBytes,
    });
    if (offset !== item.tamanhoBytes) {
      let url = this.politica(item.url).href;
      let resposta: Response | undefined;
      for (let i = 0; i <= 8; i++) {
        const r = await fetch(url, {
          redirect: 'manual',
          signal: AbortSignal.any([sinal, AbortSignal.timeout(30 * 60_000)]),
          headers: {
            'Accept-Encoding': 'identity',
            ...(offset ? { Range: `bytes=${offset}-` } : {}),
          },
        });
        if ([301, 302, 303, 307, 308].includes(r.status)) {
          await r.body?.cancel();
          const local = r.headers.get('location');
          if (!local) throw new Error('Redirecionamento de download inválido.');
          url = this.politica(new URL(local, url).href).href;
        } else {
          resposta = r;
          break;
        }
      }
      if (!resposta?.ok || !resposta.body)
        throw new Error('Não foi possível baixar o componente de voz.');
      if (resposta.status === 206) {
        const range = resposta.headers.get('content-range');
        if (!range?.startsWith(`bytes ${offset}-`) || !range.endsWith(`/${item.tamanhoBytes}`)) {
          await resposta.body.cancel();
          throw new Error('Retomada do download inválida.');
        }
      } else {
        offset = 0;
      }
      const arquivo = await open(parcial, offset ? 'a' : 'w', 0o600);
      let ultima = 0;
      try {
        for await (const parte of resposta.body as unknown as AsyncIterable<Uint8Array>) {
          if (sinal.aborted) throw new Error('Instalação cancelada.');
          offset += parte.length;
          if (offset > item.tamanhoBytes) throw new Error('Download maior que o tamanho esperado.');
          await arquivo.write(parte);
          if (Date.now() - ultima >= 250) {
            ultima = Date.now();
            this.emitir({
              componente: item.componente,
              etapa: 'baixando',
              baixadoBytes: offset,
              totalBytes: item.tamanhoBytes,
            });
          }
        }
      } finally {
        await arquivo.close();
      }
    }
    if (sinal.aborted) throw new Error('Instalação cancelada.');
    this.emitir({
      componente: item.componente,
      etapa: 'verificando',
      baixadoBytes: offset,
      totalBytes: item.tamanhoBytes,
    });
    if (offset !== item.tamanhoBytes || (await hashArquivo(parcial, sinal)) !== item.sha256) {
      await rm(parcial, { force: true });
      throw new Error('Hash SHA-256 divergente. O download foi apagado; tente novamente.');
    }
    if (sinal.aborted) throw new Error('Instalação cancelada.');
    if (item.zip) {
      this.emitir({ componente: item.componente, etapa: 'extraindo' });
      const temporario = await mkdtemp(join(cache, 'extracao-'));
      try {
        await extrairBinarios(parcial, temporario, item.componente, sinal);
        const bin = join(this.pasta, 'bin');
        await mkdir(bin, { recursive: true, mode: 0o700 });
        // Publica DLLs antes do executável que a detecção procura.
        for (const nome of (await readdir(temporario)).sort(
          (a, b) => Number(a.endsWith('.exe')) - Number(b.endsWith('.exe')),
        )) {
          if (sinal.aborted) throw new Error('Instalação cancelada.');
          await rename(join(temporario, nome), join(bin, nome));
        }
        await rm(parcial, { force: true });
      } finally {
        await rm(temporario, { recursive: true, force: true });
      }
    } else {
      const modelos = join(this.pasta, 'modelos');
      await mkdir(modelos, { recursive: true, mode: 0o700 });
      await rename(parcial, join(modelos, item.arquivo));
    }
  }
}
