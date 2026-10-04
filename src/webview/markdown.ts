/// <reference lib="dom" />
// Renderizacao segura de markdown das falas: marked para converter, DOMPurify para sanitizar.
// Links nunca navegam dentro do webview: viram pedido 'abrirLink', que passa pelo Portao no host.
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { enviar, h, icone } from './util';

marked.setOptions({ gfm: true, breaks: true });

export function renderMarkdown(texto: string): HTMLElement {
  const html = DOMPurify.sanitize(marked.parse(texto, { async: false }) as string, {
    FORBID_TAGS: ['style', 'iframe', 'form', 'input', 'img'],
    FORBID_ATTR: ['style'],
  });
  const raiz = h('div', { class: 'md' });
  raiz.innerHTML = html;

  for (const a of Array.from(raiz.querySelectorAll('a'))) {
    const url = a.getAttribute('href') ?? '';
    a.removeAttribute('href');
    a.setAttribute('role', 'link');
    a.setAttribute('tabindex', '0');
    a.title = url;
    const abrir = (e: Event) => { e.preventDefault(); if (/^https?:\/\//i.test(url)) enviar({ tipo: 'abrirLink', url }); };
    a.addEventListener('click', abrir);
    a.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') abrir(e); });
  }

  for (const pre of Array.from(raiz.querySelectorAll('pre'))) {
    const codigo = pre.textContent ?? '';
    const btn = h('button', { class: 'copiar', type: 'button', title: 'Copiar', 'aria-label': 'Copiar codigo' }, icone('copiar'));
    btn.addEventListener('click', () => {
      void navigator.clipboard.writeText(codigo).then(() => { btn.classList.add('ok'); setTimeout(() => btn.classList.remove('ok'), 1200); });
    });
    pre.append(btn);
  }
  return raiz;
}
