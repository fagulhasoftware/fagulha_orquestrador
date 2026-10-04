/// <reference lib="dom" />
// Utilitarios do webview: criacao de elementos, ponte com o host e formatacao.
import type { DoHost, DoWebview } from '../shared/protocolo';

interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(s: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;
const api = acquireVsCodeApi();

export const enviar = (msg: DoWebview): void => api.postMessage(msg);
export const ouvir = (fn: (msg: DoHost) => void): void =>
  window.addEventListener('message', (e: MessageEvent<DoHost>) => fn(e.data));

// Estado local do proprio webview (rascunho, aba): sobrevive a ocultar/mostrar o painel.
export interface Local { rascunho: string; vista: Vista }
export type Vista = 'chat' | 'agentes' | 'config' | 'chats';
export const local = (): Local => ({ rascunho: '', vista: 'chat', ...(api.getState() as Partial<Local> | undefined) });
export const salvarLocal = (parcial: Partial<Local>): void => api.setState({ ...local(), ...parcial });

type Filho = Node | string | null | undefined | false;
type Atributos = Record<string, string | number | boolean | EventListener | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, atrs: Atributos = {}, ...filhos: (Filho | Filho[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(atrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const f of filhos.flat()) if (f !== null && f !== undefined && f !== false) el.append(f);
  return el;
}

// Icones codicon-like em SVG inline (sem fonte externa, compativel com a CSP).
const PATHS: Record<string, string> = {
  enviar: 'M1.7 1.2 14.9 7.6c.3.2.3.6 0 .8L1.7 14.8c-.4.2-.8-.2-.7-.6L2.6 8.5 9 8 2.6 7.5 1 1.8c-.1-.4.3-.8.7-.6z',
  parar: 'M3 3h10v10H3z',
  clipe: 'M10.5 3.5 5 9a1.4 1.4 0 0 0 2 2l5.8-5.8a2.8 2.8 0 0 0-4-4L3 7a4.2 4.2 0 0 0 6 6l4.5-4.5-.9-.9L8 12.1A2.9 2.9 0 0 1 3.9 8l5.8-5.8a1.5 1.5 0 0 1 2.1 2.1L6 10.1a.1.1 0 0 1-.1-.1l5.5-5.5z',
  contexto: 'M2 2h9v2H4v7H2zm4 4h8v8H6zm2 2v4h4V8z',
  mic: 'M8 1a2.5 2.5 0 0 0-2.5 2.5v4a2.5 2.5 0 0 0 5 0v-4A2.5 2.5 0 0 0 8 1zM3.5 7H5a3 3 0 0 0 6 0h1.5a4.5 4.5 0 0 1-3.8 4.4V14h-1.4v-2.6A4.5 4.5 0 0 1 3.5 7z',
  engrenagem: 'M9.2 1l.4 1.8 1.2.6 1.6-1 1.7 1.7-1 1.6.5 1.2 1.9.4v2.4l-1.9.4-.5 1.2 1 1.6-1.7 1.7-1.6-1-1.2.5-.4 1.9H6.8l-.4-1.9-1.2-.5-1.6 1-1.7-1.7 1-1.6-.5-1.2L.6 9.2V6.8l1.8-.4.6-1.2-1-1.6 1.7-1.7 1.6 1 1.2-.6L6.8 1zM8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
  pessoas: 'M5.5 2a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zm5.5 1a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM1 13c0-2.5 2-4.5 4.5-4.5S10 10.5 10 13v1H1zm10 1v-1c0-1.3-.4-2.5-1.1-3.4A3.5 3.5 0 0 1 15 13v1z',
  fechar: 'M3.5 2.5 8 7l4.5-4.5 1 1L9 8l4.5 4.5-1 1L8 9l-4.5 4.5-1-1L7 8 2.5 3.5z',
  exportar: 'M8 1 4.5 4.5l1 1L7.3 3.7V10h1.4V3.7l1.8 1.8 1-1zM2 9h1.4v4.6h9.2V9H14v6H2z',
  voltar: 'M6.5 3 1.5 8l5 5 1-1-3.3-3.3H14.5V7.3H4.2L7.5 4z',
  escudo: 'M8 1 2 3.5V8c0 3.3 2.6 6.2 6 7 3.4-.8 6-3.7 6-7V3.5zm0 1.5 4.6 1.9V8c0 2.5-1.9 4.8-4.6 5.5z',
  mais: 'M7.3 2h1.4v5.3H14v1.4H8.7V14H7.3V8.7H2V7.3h5.3z',
  som: 'M2 6h2.5L8 3v10L4.5 10H2zm8.2-.9a4 4 0 0 1 0 5.8l-1-1a2.6 2.6 0 0 0 0-3.8zm2-2a6.8 6.8 0 0 1 0 9.8l-1-1a5.4 5.4 0 0 0 0-7.8z',
  chats: 'M1.5 2h9v6.5H5L2.5 11V8.5h-1zm1.4 1.4v3.7h1V8l1.5-1.5h4.7V3.4zM12 5h2.5v6.5h-1V14L11 11.5H6V10h5.6l.4.4v-.4h1.1V6.4H12z',
  fixar: 'M10.5 1.5 14.5 5.5l-1 1-1-.4-2.6 2.6.3 2.8-1 1L6.6 9.9 3 13.5 2.5 13l3.6-3.6L3.5 6.8l1-1 2.8.3 2.6-2.6-.4-1z',
  lapis: 'M11.3 1.7a1.6 1.6 0 0 1 2.3 0l.7.7a1.6 1.6 0 0 1 0 2.3L5.6 13.4 1.5 14.5l1.1-4.1zM3.8 10.9l-.5 1.8 1.8-.5 7.4-7.4-1.3-1.3z',
  lixeira: 'M6 1h4l.5 1H14v1.4H2V2h3.5zM3 4.5h10l-.8 10.5H3.8zm1.5 1.4.6 7.7h5.8l.6-7.7z',
  copiar: 'M4 4V1.5h10.5V12H12v2.5H1.5V4zm1.4 0H12v6.6h1.1V2.9H5.4zM2.9 5.4v7.7h7.7V5.4z',
};
export function icone(nome: keyof typeof PATHS | string, titulo?: string): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('class', 'ic');
  svg.setAttribute('aria-hidden', titulo ? 'false' : 'true');
  if (titulo) { const t = document.createElementNS(ns, 'title'); t.textContent = titulo; svg.append(t); }
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', PATHS[nome] ?? '');
  p.setAttribute('fill', 'currentColor');
  p.setAttribute('fill-rule', 'evenodd');
  svg.append(p);
  return svg;
}

export function botaoIcone(nome: string, titulo: string, onclick: () => void, extra = ''): HTMLButtonElement {
  return h('button', { class: `bi ${extra}`, title: titulo, 'aria-label': titulo, type: 'button', onclick: () => onclick() }, icone(nome));
}

export const hora = (iso: string): string => iso.slice(11, 16);
export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
