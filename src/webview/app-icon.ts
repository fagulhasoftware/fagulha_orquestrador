import { h, icone } from './util';
import { logos } from './app-logos';

export function iconeAplicativo(id: string, nome: string, url?: string): HTMLElement {
  const chave = id.replace(/:.*$/, '');
  const aliases: Record<string, string> = { 'google chrome': 'google-chrome', 'google drive': 'google-drive', 'google calendar': 'google-calendar' };
  const svg = logos[chave] ?? logos[aliases[nome.toLowerCase()] ?? nome.toLowerCase()];
  const src = svg ? `data:image/svg+xml,${encodeURIComponent(svg)}` : url;
  const fallback = () => h('span', { class: 'app-icone fallback', title: nome, 'aria-hidden': 'true' }, icone('plug'));
  if (!src) return fallback();
  const img = h('img', { class: 'app-icone', src, alt: '', referrerpolicy: 'no-referrer', loading: 'lazy' });
  img.addEventListener('error', () => img.replaceWith(fallback()), { once: true });
  return img;
}
