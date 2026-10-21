export function textoParaLeitura(texto: string, limite = 1500): string {
  return texto
    .slice(0, 100_000)
    .replace(
      /```[^\n]*\n[\s\S]*?(?:```|$)|~~~[^\n]*\n[\s\S]*?(?:~~~|$)/g,
      ' trecho de codigo omitido ',
    )
    .replace(/^(?: {4}|\t).+(?:\r?\n(?: {4}|\t).+)*/gm, ' trecho de codigo omitido ')
    .replace(/`[^`]*`/g, ' trecho de codigo omitido ')
    .replace(/<(?:pre|code)\b[^>]*>[\s\S]*?<\/(?:pre|code)>/gi, ' trecho de codigo omitido ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/^\s*(?:#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_`~|]/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limite);
}
