import { basename, relative, isAbsolute, resolve, dirname } from 'node:path';
import { realpath } from 'node:fs/promises';

const segredos = [
  /\bsk-[\w-]{16,}/g,
  /\bAIza[\w-]{20,}/g,
  /\bgh[pousr]_[\w]{20,}/g,
  /\bxox[abp]-[\w-]{16,}/g,
  /\beyJ[\w-]{20,}\.[\w-]+\.[\w-]+/g,
  /\bAQ\.[\w-]{20,}/g,
];
const conhecidos = new Set<string>();
export function protegerSegredo(valor: string): void {
  // Entradas inválidas de um ou dois caracteres não podem corromper toda mensagem
  // ao serem usadas como padrão de redação. Chaves aceitas pelo login têm >=12 caracteres.
  if (valor.length >= 8) conhecidos.add(valor);
}
export function mascarar(texto: string): string {
  for (const segredo of conhecidos) texto = texto.split(segredo).join('[segredo oculto]');
  return segredos
    .reduce((s, re) => s.replace(re, '[segredo oculto]'), texto)
    .replace(
      /((?:api[_-]?key|authorization|password|token|secret)\s*[:=]\s*)[^\s,;]+/gi,
      '$1[segredo oculto]',
    );
}
export function sensivel(caminho: string): boolean {
  return caminho
    .split(/[\\/]/)
    .some((p) =>
      /^(\.env(?:\..*)?|\.aws|\.ssh|\.gnupg|\.git|credentials(?:\..*)?|auth\.json|secrets?(?:\..*)?|tokens?(?:\..*)?|backups?|id_(rsa|ed25519)|.*\.(pem|key|pfx|p12|sqlite|db|bak|backup))$/i.test(
        p,
      ),
    );
}
export function dentro(raiz: string, caminho: string): boolean {
  const rel = relative(raiz, caminho);
  return (
    rel === '' ||
    (!isAbsolute(rel) &&
      rel !== '..' &&
      !rel.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')))
  );
}
export async function caminhoReal(caminho: string, escrita = false): Promise<string> {
  const absoluto = resolve(caminho);
  if (sensivel(absoluto)) throw new Error('Arquivo protegido: acesso recusado.');
  let real: string;
  try {
    real = await realpath(absoluto);
  } catch (e) {
    if (!escrita || (e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    real = resolve(await realpath(dirname(absoluto)), basename(absoluto));
  }
  if (sensivel(real)) throw new Error('Destino protegido: acesso recusado.');
  return real;
}
