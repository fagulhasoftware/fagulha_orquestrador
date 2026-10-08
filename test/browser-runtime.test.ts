import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { resolve } from 'node:path';
const { corrigirCodigo } = require(resolve('scripts/corrigir-browser-runtime.cjs')) as {
  corrigirCodigo: (codigo: string) => string;
};
const trecho = `const processShim = { env: {}, on: () => 'local', listeners: () => [] };
  globalThis.process = processShim;
  globalThis.global = globalThis.global ?? globalThis;
  globalThis.global.process = processShim;`;

test('runtime usa aliases privados sem substituir process protegido nem os globals do host', () => {
  const protegido = Object.freeze({ env: Object.freeze({}), pid: 123 });
  const host: any = {};
  Object.defineProperty(host, 'process', {
    value: protegido,
    writable: false,
    configurable: false,
  });
  host.global = host;
  const original = `'use strict'; (function(){${trecho}})()`;
  assert.throws(() => runInNewContext(original, host), /process/);
  const corrigido = `'use strict'; (function(){${corrigirCodigo(trecho)}; return {on:global.process.on(),pid:globalThis.process.pid};})()`;
  const resultado = runInNewContext(corrigido, host);
  assert.equal(resultado.on, 'local');
  assert.equal(resultado.pid, 123);
  assert.equal(host.process, protegido);
  assert.equal(host.global, host);
  assert.equal(Object.getOwnPropertyDescriptor(host, 'process')!.configurable, false);
});
test('correcao e idempotente e recusa codigo desconhecido ou duplicado', () => {
  const corrigido = corrigirCodigo(trecho);
  assert.equal(corrigirCodigo(corrigido), corrigido);
  assert.throws(() => corrigirCodigo('export const outro = 1;'), /desconhecido/);
  assert.throws(() => corrigirCodigo(trecho + trecho), /desconhecido/);
});
