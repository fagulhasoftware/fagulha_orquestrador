import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { detectarVoz } from '../src/voice/deteccao';
import { padraoVoz, carregarConfiguracao } from '../src/voice/configuracao';
import { validarMensagem } from '../src/core/protocolo';
import { artefato } from '../src/voice/catalogo';
import { temporario } from './apoio';

test('leitura sem dependencias: nao detecta player externo nem solicita Piper', async () => {
  const tmp = await temporario(),
    comandos: string[] = [];
  try {
    const r = await detectarVoz(tmp.pasta, padraoVoz(), 'win32', (cmd) => {
      comandos.push(cmd);
      return {
        resultado: Promise.resolve({ codigo: 1, saida: '', erro: '' }),
        escrever: () => {},
        fecharEntrada: () => {},
        cancelar: () => {},
      };
    });
    assert.equal(r.estado.leitura.disponivel, true);
    assert.equal(r.estado.disponivel, false);
    assert.deepEqual(
      r.estado.componentes.map((c) => c.componente),
      ['ffmpeg', 'whisper', 'modelo'],
    );
    assert(!comandos.some((c) => /piper|powershell|say|espeak|aplay|afplay/i.test(c)));
    assert.throws(() => validarMensagem({ tipo: 'vozInstalar', componentes: ['piper'] }));
    assert.throws(() => artefato('piper', 'small'));
  } finally {
    await tmp.limpar();
  }
});
test('configuracao Piper antiga migra para sistema preservando ditado e velocidade', async () => {
  const tmp = await temporario();
  try {
    const arquivo = join(tmp.pasta, 'config.json');
    await writeFile(
      arquivo,
      JSON.stringify({
        modelo: 'base',
        dispositivo: 'microfone',
        leitura: { motor: 'piper', velocidade: 1.3 },
      }),
    );
    const c = await carregarConfiguracao(arquivo);
    assert.equal(c.leitura.motor, 'sistema');
    assert.equal(c.leitura.velocidade, 1.3);
    assert.equal(c.modelo, 'base');
    assert.equal(c.dispositivo, 'microfone');
  } finally {
    await tmp.limpar();
  }
});
