import type { Mensagem } from '../shared/protocolo';
import { textoParaLeitura } from './leitor';
export function trechoAutomatico(texto: string, anuncio = false): string {
  const semBlocos = texto
    .replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g, '')
    .replace(/`[^`]*`/g, '')
    .split(/\r?\n/)
    .filter((l) => !/\||^(?: {4}|\t)/.test(l))
    .join('\n');
  const paragrafos = semBlocos
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join('\n\n');
  if (anuncio && (texto.length > 300 || /```|~~~|\|/.test(texto))) return '';
  return textoParaLeitura(paragrafos).slice(0, anuncio ? 300 : 600);
}
export class TurnosVoz {
  private turnos = new Map<string, { primeira?: string; ultima?: Mensagem }>();
  iniciar(agente: string): void {
    this.turnos.set(agente, {});
  }
  mensagem(agente: string, m: Mensagem): Mensagem | undefined {
    if (m.parcial || m.tipo !== 'fala') return;
    const turno = this.turnos.get(agente) ?? {};
    this.turnos.set(agente, turno);
    const primeira = !turno.ultima;
    turno.ultima = m;
    const texto = primeira ? trechoAutomatico(m.texto, true) : '';
    if (texto) {
      turno.primeira = m.id;
      return { ...m, texto };
    }
  }
  concluir(agente: string): Mensagem | undefined {
    const turno = this.turnos.get(agente);
    this.turnos.delete(agente);
    if (!turno?.ultima || turno.ultima.id === turno.primeira) return;
    const texto = trechoAutomatico(turno.ultima.texto);
    if (texto) return { ...turno.ultima, texto };
  }
}
