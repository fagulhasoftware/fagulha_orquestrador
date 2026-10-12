import { open } from 'node:fs/promises';
import { ErroFerramenta } from '../mcp/erros';

export type ConteudoImagem = {
  conteudoMcp: (
    { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
  )[];
};
export function eConteudoImagem(v: unknown): v is ConteudoImagem {
  return !!v && typeof v === 'object' && 'conteudoMcp' in v && Array.isArray(v.conteudoMcp);
}
export async function lerImagem(caminho: string, limiteMB = 10): Promise<ConteudoImagem> {
  const arquivo = await open(caminho, 'r');
  try {
    const info = await arquivo.stat();
    if (!info.isFile()) throw new ErroFerramenta('Imagem deve ser arquivo.');
    if (info.size > Math.min(limiteMB, 10) * 1024 * 1024)
      throw new ErroFerramenta('Arquivo maior que o limite de imagem.');
    const buffer = Buffer.alloc(info.size + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const r = await arquivo.read(buffer, bytes, buffer.length - bytes, null);
      if (!r.bytesRead) break;
      bytes += r.bytesRead;
    }
    if (bytes !== info.size) throw new ErroFerramenta('Imagem mudou durante a leitura.');
    const b = buffer.subarray(0, bytes);
    const mimeType = b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? 'image/png'
      : b[0] === 255 && b[1] === 216 && b[2] === 255
        ? 'image/jpeg'
        : /^GIF8[79]a$/.test(b.subarray(0, 6).toString('ascii'))
          ? 'image/gif'
          : b.subarray(0, 4).toString('ascii') === 'RIFF' &&
              b.subarray(8, 12).toString('ascii') === 'WEBP'
            ? 'image/webp'
            : undefined;
    if (!mimeType) throw new ErroFerramenta('Tipo de imagem nao suportado ou conteudo invalido.');
    return {
      conteudoMcp: [
        { type: 'text', text: `Imagem (${mimeType}, ${bytes} bytes).` },
        { type: 'image', data: b.toString('base64'), mimeType },
      ],
    };
  } finally {
    await arquivo.close();
  }
}
