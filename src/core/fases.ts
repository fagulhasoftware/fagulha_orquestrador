import type { TipoFase } from '../shared/protocolo';
import { mascarar } from './seguranca';
export function detalheFase(valor: unknown): string | undefined {
  if (valor == null) return undefined;
  let texto = String(valor);
  try {
    const u = new URL(texto);
    texto = u.hostname + u.pathname;
  } catch {}
  return (
    mascarar(texto)
      .replace(/[\r\n\t]/g, ' ')
      .slice(0, 140) || undefined
  );
}
export function faseFerramenta(
  nome: string,
  args: Record<string, unknown> = {},
): { tipo: TipoFase; detalhe?: string } {
  const ferramenta = nome.replace(/^mcp__fagulha_orquestrador__/, '').toLowerCase();
  const tipo: TipoFase =
    ferramenta === 'perguntar_usuario'
      ? 'aguardando_resposta'
      : /web|search|navegador/.test(ferramenta)
        ? 'pesquisando_web'
        : /bash|shell|command|comando|exec/.test(ferramenta)
          ? 'executando'
          : /write|edit|patch|escrever|file_change|memoria_propor/.test(ferramenta)
            ? 'escrevendo'
            : 'lendo';
  return {
    tipo,
    detalhe: detalheFase(
      args.file_path ??
        args.caminho ??
        args.url ??
        args.command ??
        args.comando ??
        args.path ??
        args.query ??
        nome,
    ),
  };
}
