import { createHash } from 'node:crypto';
export function hashContexto(texto: string): string {
  return createHash('sha256').update(texto).digest('hex');
}
export function normalizarResposta(texto: string): string {
  return texto.trim().replace(/\s+/g, ' ').toLowerCase();
}
// Verifica apenas perguntas aritmeticas explicitas; nao tenta julgar semantica geral.
export function testeAritmetico(pergunta: string, resposta: string): boolean | undefined {
  const texto = pergunta.replace(/@[\p{L}\p{N}_:-]+/gu, '').trim();
  const m = texto.match(
    /^(?:(?:quanto (?:e|é)|qual (?:e|é) o resultado de|responda(?: apenas)?|calcule)\s*:?\s*)?(-?\d{1,4})\s*([+*])\s*(-?\d{1,4})\s*[=?!.]*$/i,
  );
  if (!m) return;
  const esperado = m[2] === '+' ? Number(m[1]) + Number(m[3]) : Number(m[1]) * Number(m[3]);
  const numeros = resposta.match(/-?\d+(?:[.,]\d+)?/g);
  if (!numeros?.length) return false;
  return Number(numeros.at(-1)!.replace(',', '.')) === esperado;
}
export class SaudeAgente {
  private ultimas = new Map<string, { pergunta: string; resposta: string }>();
  limpar(id: string): void {
    this.ultimas.delete(id);
  }
  verificar(id: string, pergunta: string, resposta: string): string | undefined {
    const antes = this.ultimas.get(id),
      atual = { pergunta: normalizarResposta(pergunta), resposta: normalizarResposta(resposta) };
    this.ultimas.set(id, atual);
    if (testeAritmetico(pergunta, resposta) === false) return 'falhou na pergunta-teste aritmetica';
    if (
      antes &&
      atual.pergunta !== antes.pergunta &&
      atual.resposta &&
      atual.resposta === antes.resposta
    )
      return 'repetiu a mesma resposta para perguntas diferentes';
  }
}
