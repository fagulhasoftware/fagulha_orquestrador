import type { Mensagem } from '../shared/protocolo';
import { mascarar } from './seguranca';
export function horarioLocal(iso: string, fuso?: string, idioma?: string): string {
  const data = new Date(iso);
  if (!Number.isFinite(data.getTime())) return 'Horario indisponivel';
  return new Intl.DateTimeFormat(idioma, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
    timeZone: fuso,
  }).format(data);
}
export function exportarMarkdown(mensagens: Mensagem[], fuso?: string, idioma?: string): string {
  return mascarar(
    mensagens
      .map((m) => `## ${m.autor} — ${horarioLocal(m.quando, fuso, idioma)}\n\n${m.texto}\n`)
      .join('\n'),
  );
}
