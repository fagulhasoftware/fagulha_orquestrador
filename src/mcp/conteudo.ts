import { eConteudoImagem } from '../attachments/imagem';
import type { ResultadoIntegracao } from '../integrations/tipos';
export function conteudoResultado(valor: unknown): {
  texto: string;
  imagens: { mime: string; base64: string }[];
  erro?: boolean;
} {
  if (!eConteudoImagem(valor)) return { texto: JSON.stringify(valor) ?? 'null', imagens: [] };
  const r = valor as ResultadoIntegracao;
  const imagens = r.conteudoMcp.flatMap((c) =>
    c.type === 'image' ? [{ mime: c.mimeType, base64: c.data }] : [],
  );
  const texto = r.conteudoMcp
    .filter((c) => c.type !== 'image')
    .map((c) => (c.type === 'text' ? c.text : JSON.stringify(c)))
    .join('\n');
  return {
    texto: texto + (r.structuredContent ? `\n${JSON.stringify(r.structuredContent)}` : ''),
    imagens,
    erro: r.isError,
  };
}
