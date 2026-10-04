import { randomBytes } from 'node:crypto';
export function montarHtml(cspSource: string, css: string, js: string): string {
  const nonce = randomBytes(24).toString('base64');
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data:; style-src ${cspSource}; script-src 'nonce-${nonce}'; font-src ${cspSource};"><title>Orquestrador Fagulha</title><link rel="stylesheet" href="${css}"></head><body><div id="app"></div><script nonce="${nonce}" src="${js}"></script></body></html>`;
}
