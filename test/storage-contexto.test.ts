import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { Armazenamento } from '../src/storage/sqlite';
import { importarContexto } from '../src/context-import/importador';
import { validarMensagem } from '../src/core/protocolo';
import { temporario } from './apoio';
import { montarHtml } from '../src/core/webview';
test('SQLite multiplas instancias preserva escritas e separa salas', async () => {
  const tmp = await temporario();
  try {
    const arquivo = join(tmp.pasta, 'dados.sqlite'),
      a = new Armazenamento(arquivo),
      b = new Armazenamento(arquivo);
    await Promise.all([a.iniciar(), b.iniciar()]);
    await Promise.all(
      Array.from({ length: 16 }, (_, i) =>
        (i % 2 ? a : b).gravar('mensagens', i < 8 ? 'sala-a' : 'sala-b', String(i), { i }),
      ),
    );
    assert.equal((await a.listar('mensagens', 'sala-a')).length, 8);
    assert.equal((await b.listar('mensagens', 'sala-b')).length, 8);
    const nova = new Armazenamento(arquivo);
    await nova.iniciar();
    assert.equal((await nova.listar('mensagens')).length, 16);
    await nova.remover('mensagens', 'sala-a', '0');
    assert.equal((await a.listar('mensagens', 'sala-a')).length, 7);
  } finally {
    await tmp.limpar();
  }
});
test('shell webview respeita CSP estrita e nonce novo por renderizacao', () => {
  const css = 'https://webview.local/media/orquestra.css',
    js = 'https://webview.local/dist/webview.js';
  const html = montarHtml('https://webview.local', css, js);
  assert(html.includes("default-src 'none'"));
  assert(!html.includes('unsafe-inline'));
  assert(html.includes('<div id="app"></div>'));
  assert(html.includes(`href="${css}"`));
  assert(html.includes(`src="${js}"`));
  const nonce = html.match(/<script nonce="([^"]+)"/)![1];
  assert(html.includes(`script-src 'nonce-${nonce}'`));
  assert.notEqual(
    montarHtml('https://webview.local', css, js).match(/<script nonce="([^"]+)"/)![1],
    nonce,
  );
});
test('importacao Claude e Codex traz so mensagens, respeita orcamento', async () => {
  const tmp = await temporario();
  try {
    const claude = join(tmp.pasta, 'claude.jsonl');
    await writeFile(
      claude,
      [
        { type: 'user', message: { content: 'pergunta' } },
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'thinking', thinking: 'pensamento privado' },
              { type: 'text', text: 'resposta' },
            ],
          },
        },
      ]
        .map((j) => JSON.stringify(j))
        .join('\n'),
    );
    const c = await importarContexto({ caminho: claude, origem: 'claude-code', titulo: 'Claude' });
    assert(c.texto.includes('pergunta'));
    assert(c.texto.includes('resposta'));
    assert(!c.texto.includes('privado'));
    const codex = join(tmp.pasta, 'codex.jsonl');
    await writeFile(
      codex,
      Array.from({ length: 150 }, (_, i) =>
        JSON.stringify({
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: `mensagem-${i}: ` + 'x'.repeat(100) }],
          },
        }),
      ).join('\n'),
    );
    const x = await importarContexto({ caminho: codex, origem: 'codex', titulo: 'Codex' }, 1000);
    assert(x.texto.includes('mensagem-149'));
    assert(!x.texto.includes('mensagem-0:'));
    assert(x.meta.caracteres <= 1000);
  } finally {
    await tmp.limpar();
  }
});
test('contrato rejeita payloads invalidos, configuracao de nivel por rota errada e arquivos remotos', () => {
  assert.deepEqual(validarMensagem({ tipo: 'pronto' }), { tipo: 'pronto' });
  assert.deepEqual(validarMensagem({ tipo: 'agenteConfigurar', id: 'ollama' }), {
    tipo: 'agenteConfigurar',
    id: 'ollama',
  });
  assert.equal(
    validarMensagem({ tipo: 'anexarCaminhos', uris: ['file:///x.txt'] }).tipo,
    'anexarCaminhos',
  );
  assert.throws(() => validarMensagem({ tipo: 'enviar', texto: 'oi', anexos: 123 }));
  assert.throws(() => validarMensagem({ tipo: 'configurar', parcial: { nivel: 'total' } }));
  assert.throws(() => validarMensagem({ tipo: 'pronto', extra: 'invalido' }));
  assert.throws(() => validarMensagem({ tipo: 'agenteModo', id: 'x', modo: 'bypass' }));
});
