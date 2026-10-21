import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agruparAtividades, tituloAtividade } from '../src/core/atividades';
import { Sala } from '../src/core/sala';
import { agentePadrao } from '../src/providers/tipos';
import { validarMensagem } from '../src/core/protocolo';
import { banco, temporario } from './apoio';
import type { Mensagem } from '../src/shared/protocolo';
const m = (id: string, tipo: Mensagem['tipo'], turno?: string): Mensagem => ({
  id,
  sala: 's',
  autor: 'Claude',
  quando: new Date().toISOString(),
  tipo,
  texto: id,
  requisicaoId: turno,
});
test('um grupo por turno apesar de erro intercalado, detalhes na ordem e final separado', () => {
  const blocos = agruparAtividades([
    m('contexto', 'acao', 't'),
    m('erro visivel', 'erro', 't'),
    m('auth', 'sistema', 't'),
    m('comando', 'acao', 't'),
    { ...m('preview', 'fala', 't'), parcial: true },
    m('final', 'fala', 't'),
    m('outro', 'acao', 'u'),
  ]);
  assert.equal(blocos.filter((b) => b.tipo === 'atividades').length, 2);
  const g = blocos[0];
  assert.equal(g.tipo, 'atividades');
  if (g.tipo === 'atividades')
    assert.deepEqual(
      g.acoes.map((m) => m.id),
      ['contexto', 'auth', 'comando'],
    );
  assert.deepEqual(
    blocos
      .filter((b) => b.tipo === 'mensagem')
      .map((b) => (b.tipo === 'mensagem' ? b.mensagem.texto : '')),
    ['erro visivel', 'final'],
  );
  assert(!tituloAtividade('usa Write: C:/temp/contexto123 senha').includes('temp'));
});
test('turno vazio ativo aparece e atividades legadas ainda agrupam sem misturar falas', () => {
  assert.equal(
    agruparAtividades(
      [],
      [{ id: 't', agente: 'a', autor: 'A', inicio: new Date().toISOString() }],
    )[0].tipo,
    'atividades',
  );
  assert.equal(
    agruparAtividades([m('a', 'acao'), m('b', 'acao'), m('f', 'fala'), m('c', 'acao')]).length,
    3,
  );
});
test('passagens aceitam 50, recusam 51 e limite ainda impede loops', async () => {
  assert.equal(
    validarMensagem({ tipo: 'configurar', parcial: { passagensAutomaticas: 50 } }).tipo,
    'configurar',
  );
  assert.throws(() =>
    validarMensagem({ tipo: 'configurar', parcial: { passagensAutomaticas: 51 } }),
  );
  const tmp = await temporario();
  try {
    const s = new Sala('s', null, 'Sala', await banco(tmp.pasta));
    let vezes = 0;
    for (const id of ['a', 'b'])
      s.registrar({
        agente: agentePadrao(id, id, 'cli', 'azul'),
        detectar: async () => ({ instalado: true }),
        estadoLogin: async () => 'conectado',
        login: async () => {},
        executar: async (p, e) => {
          vezes++;
          e.acao('acao ' + vezes);
          e.fala('@' + (id === 'a' ? 'b' : 'a') + ' turno ' + vezes);
        },
      });
    await s.iniciar();
    await s.configurar({ passagensAutomaticas: 50 });
    s.enviar('@a iniciar', []);
    await s.esperar();
    assert.equal(vezes, 51);
    const blocos = agruparAtividades(s.mensagens, s.estado().turnos);
    assert.equal(blocos.filter((b) => b.tipo === 'atividades').length, 51);
    const nova = new Sala('s', null, 'Sala', s.storage);
    await nova.iniciar();
    assert.equal(nova.estado().turnos?.filter((t) => t.fim).length, 51);
  } finally {
    await tmp.limpar();
  }
});
