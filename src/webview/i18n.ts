/// <reference lib="dom" />
// Internationalization of the chat UI. English is the source language: the text passed to t() is the English
// version and the key of the catalogs. The language follows VS Code's display language (navigator.language in
// the webview); anything other than Portuguese, Spanish or German falls back to English.
import { CATALOGO_PT_BR } from './i18n/pt-br';
import { CATALOGO_ES } from './i18n/es';
import { CATALOGO_DE } from './i18n/de';

export type Idioma = 'en' | 'pt-br' | 'es' | 'de';

function detectar(): Idioma {
  const l = (navigator.language || 'en').toLowerCase();
  if (l.startsWith('pt')) return 'pt-br';
  if (l.startsWith('es')) return 'es';
  if (l.startsWith('de')) return 'de';
  return 'en';
}

export const idioma: Idioma = detectar();
export const localeIntl: string = ({ en: 'en-US', 'pt-br': 'pt-BR', es: 'es-ES', de: 'de-DE' } as const)[idioma];

const CATALOGOS: Record<Exclude<Idioma, 'en'>, Record<string, string>> = {
  'pt-br': CATALOGO_PT_BR,
  es: CATALOGO_ES,
  de: CATALOGO_DE,
};

/** Translates an English source text; `{name}` placeholders are replaced by `params`. */
export function t(texto: string, params?: Record<string, string | number>): string {
  const traduzido = idioma === 'en' ? texto : (CATALOGOS[idioma][texto] ?? texto);
  return params ? traduzido.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : traduzido;
}
