import type { BlocoConversa } from '../core/atividades';
import { tituloAtividade } from '../core/atividades';
import { h, hora } from './util';
const abertos = new Map<string, boolean>();
const itensAbertos = new Set<string>();
export function tempoAtividade(inicio: string, fim?: string): string {
  const segundos = Math.max(
    0,
    Math.floor(((fim ? Date.parse(fim) : Date.now()) - Date.parse(inicio)) / 1000),
  );
  return segundos < 60 ? `${segundos}s` : `${Math.floor(segundos / 60)}m ${segundos % 60}s`;
}
export function componenteAtividades(
  grupo: Extract<BlocoConversa, { tipo: 'atividades' }>,
  expandido: boolean,
): HTMLElement {
  const t = grupo.turno,
    inicio = t?.inicio ?? grupo.acoes[0]?.quando ?? new Date().toISOString(),
    fim = t?.fim ?? (t ? undefined : grupo.acoes.at(-1)?.quando);
  const resumo = h(
    'summary',
    { 'aria-expanded': String(abertos.get(grupo.id) ?? expandido) },
    h('span', { class: 'execucao-autor' }, grupo.autor),
    h(
      'span',
      { 'data-atividade-tempo': '', 'data-inicio': inicio, ...(fim ? { 'data-fim': fim } : {}) },
      ` trabalhou por ${tempoAtividade(inicio, fim)}`,
    ),
    ` · ${grupo.acoes.length} ${grupo.acoes.length === 1 ? 'acao' : 'acoes'}`,
    !fim ? h('span', { class: 'atividade-atual' }, ` · ${faseSegura(t?.fase?.tipo)}`) : null,
  );
  const detalhes = h(
    'details',
    { class: 'grupo-acoes', 'data-turno': grupo.id },
    resumo,
    h(
      'div',
      { class: 'execucao-detalhes' },
      ...grupo.acoes.map((m) => {
        const s = h(
          'summary',
          { 'aria-expanded': String(itensAbertos.has(m.id)) },
          h('time', {}, hora(m.quando)),
          ` · ${tituloAtividade(m.texto)}`,
        );
        const d = h('details', { class: 'atividade-item' }, s, h('pre', {}, m.texto));
        d.open = itensAbertos.has(m.id);
        d.addEventListener('toggle', () => {
          if (!d.isConnected) return;
          s.setAttribute('aria-expanded', String(d.open));
          if (d.open) itensAbertos.add(m.id);
          else itensAbertos.delete(m.id);
        });
        return d;
      }),
    ),
  );
  detalhes.open = abertos.get(grupo.id) ?? expandido;
  detalhes.addEventListener('toggle', () => {
    if (!detalhes.isConnected) return;
    abertos.set(grupo.id, detalhes.open);
    resumo.setAttribute('aria-expanded', String(detalhes.open));
  });
  return detalhes;
}
function faseSegura(tipo?: string): string {
  return (
    (
      {
        executando: 'Executando shell...',
        lendo: 'Lendo contexto...',
        escrevendo: 'Escrevendo arquivos...',
        pesquisando_web: 'Consultando a web...',
        respondendo: 'Preparando resposta...',
        aguardando_aprovacao: 'Aguardando aprovacao',
        aguardando_resposta: 'Aguardando sua resposta',
      } as Record<string, string>
    )[tipo ?? ''] ?? 'Trabalhando...'
  );
}
export function atualizarTemposAtividades(): void {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-atividade-tempo]')))
    el.textContent = ` trabalhou por ${tempoAtividade(el.dataset.inicio!, el.dataset.fim)}`;
}
