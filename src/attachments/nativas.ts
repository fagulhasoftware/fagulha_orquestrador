import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AnexoArmazenado } from './pipeline';
import { lerImagem } from './imagem';
import type { NivelPermissao } from '../shared/protocolo';

export async function imagensNativas(
  anexos: AnexoArmazenado[],
  nivel: NivelPermissao,
  diretorio: string,
  limiteMB: number,
): Promise<string[]> {
  if (nivel === 'manual') return [];
  const caminhos: string[] = [];
  for (const a of anexos
    .filter((x) => x.meta.tipo === 'imagem' && x.meta.tratamento !== 'recusado' && x.arquivo)
    .slice(-4)) {
    const r = await lerImagem(a.arquivo!, limiteMB);
    const imagem = r.conteudoMcp.find((c) => c.type === 'image')!;
    if (imagem.type !== 'image') continue;
    const ext = (
      {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/webp': 'webp',
        'image/gif': 'gif',
      } as Record<string, string>
    )[imagem.mimeType];
    await mkdir(diretorio, { recursive: true });
    const caminho = join(diretorio, `imagem-${caminhos.length}.${ext}`);
    await writeFile(caminho, Buffer.from(imagem.data, 'base64'), { mode: 0o600 });
    caminhos.push(caminho);
  }
  return caminhos;
}
