import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sala } from '../src/core/sala';
import { agentePadrao, type Provedor } from '../src/providers/tipos';
import { banco, temporario } from './apoio';

function provedor(id: string, executar: Provedor['executar']): Provedor {
  return { agente: agentePadrao(id, id, 'cli', 'azul'), executar,
    detectar: async () => ({ instalado: true }), estadoLogin: async () => 'conectado', login: async () => {} };
}

test('reabertura encerra turno legado sem dono em vez de contar horas como trabalhando', async () => {
  const tmp = await temporario();
  try {
    const db = await banco(tmp.pasta);
    const primeira = new Sala('s', null, 'Sala', db);
    await primeira.iniciar();
    await db.gravarDoChat('acoes', primeira.chat.id, 'turno:antigo', {
      id:'antigo', agente:'codex', autor:'Codex', registroTurno:true,
      inicio:new Date(Date.now()-906*60_000).toISOString(), fase:{tipo:'pensando', desde:new Date().toISOString()},
    });
    const nova = new Sala('s', null, 'Sala', db);
    await nova.iniciar();
    const turno = nova.estado().turnos?.find((t) => t.id === 'antigo');
    assert.ok(turno?.fim, 'Turno sem dono permanece trabalhando depois de reabrir');
    assert.equal(turno?.fase?.tipo, 'interrompido');
    await nova.esperar();
    const salvo = await db.obter<any>('acoes', nova.chat.id, 'turno:antigo');
    assert.ok(salvo.fim);
  } finally { await tmp.limpar(); }
});

test('parar libera fila mesmo quando provedor ignora abort e descarta sua saida atrasada', async () => {
  const tmp = await temporario();
  let liberar!: () => void;
  try {
    const s = new Sala('s', null, 'Sala', await banco(tmp.pasta), { cancelamentoMs:20, limpezaMs:30 });
    let iniciou!: () => void;
    const inicio = new Promise<void>((resolve) => { iniciou = resolve; });
    const espera = new Promise<void>((resolve) => { liberar = resolve; });
    s.registrar(provedor('codex', async (_, e) => { iniciou(); await espera; e.fala('saida velha'); }));
    s.registrar(provedor('claude', async (_, e) => { e.fala('resposta nova'); }));
    await s.iniciar();
    s.enviar('@codex iniciar', []);
    await inicio;
    s.parar();
    try {
      await Promise.race([s.esperar(), new Promise((_, reject) => setTimeout(() => reject(new Error('Fila nao liberada apos cancelamento')), 300))]);
      assert.notEqual(s.provedores.get('codex')!.agente.estado, 'trabalhando');
      s.enviar('@claude prossiga', []);
      await s.esperar();
      assert.ok(s.mensagens.some((m) => m.texto === 'resposta nova'));
    } finally { liberar(); await s.esperar(); }
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(!s.mensagens.some((m) => m.texto === 'saida velha'));
  } finally { liberar?.(); await tmp.limpar(); }
});

test('outra sala preserva turno ainda ativo no mesmo processo', async () => {
  const tmp = await temporario();
  let liberar!: () => void;
  try {
    const db = await banco(tmp.pasta);
    const s = new Sala('s', null, 'Sala', db);
    let iniciou!: () => void;
    const inicio = new Promise<void>((resolve) => { iniciou = resolve; });
    const espera = new Promise<void>((resolve) => { liberar = resolve; });
    s.registrar(provedor('codex', async () => { iniciou(); await espera; }));
    await s.iniciar();
    s.enviar('@codex trabalhar', []);
    await inicio;
    const segunda = new Sala('s', null, 'Sala', db);
    await segunda.iniciar();
    assert.equal(segunda.estado().turnos?.filter((t) => !t.fim).length, 1);
    liberar(); await s.esperar();
    await segunda.sincronizar();
    assert.equal(segunda.estado().turnos?.filter((t) => !t.fim).length, 0);
  } finally { liberar?.(); await tmp.limpar(); }
});

test('trocar chat cancela preparacao presa e limpa recurso tardio sem iniciar provedor', async () => {
  const tmp = await temporario();
  let liberar!: (valor: any) => void;
  try {
    const s = new Sala('s', null, 'Sala', await banco(tmp.pasta), {cancelamentoMs:20,limpezaMs:30});
    let iniciou!: () => void;
    const inicio = new Promise<void>((resolve) => { iniciou = resolve; });
    const espera = new Promise<any>((resolve) => { liberar = resolve; });
    let execucoes = 0, limpezas = 0;
    s.registrar(provedor('codex', async () => { execucoes++; }));
    s.preparar = async () => { iniciou(); return espera; };
    await s.iniciar();
    const chatAnterior = s.chat.id;
    s.enviar('@codex preparar', []);
    await inicio;
    await s.novoChat();
    assert.notEqual(s.chat.id, chatAnterior);
    liberar({pedido:{},regras:[],limpar:async () => { limpezas++; }});
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.equal(execucoes, 0);
    assert.equal(limpezas, 1);
    assert.ok(!s.mensagens.some((m) => m.texto.includes('@codex preparar')));
    await s.esperar();
  } finally { liberar?.({pedido:{},regras:[],limpar:async()=>{}}); await tmp.limpar(); }
});

test('limpeza que nao conclui tem prazo e nao deixa turno trabalhando', async () => {
  const tmp = await temporario();
  try {
    const s = new Sala('s', null, 'Sala', await banco(tmp.pasta), {cancelamentoMs:20,limpezaMs:20});
    s.registrar(provedor('codex', async (_, e) => { e.fala('concluido'); }));
    s.preparar = async () => ({pedido:{},regras:[],limpar:() => new Promise<void>(()=>{})});
    await s.iniciar();
    s.enviar('@codex executar', []);
    await s.esperar();
    assert.equal(s.provedores.get('codex')!.agente.estado, 'livre');
    assert.ok(s.estado().turnos?.every((t) => t.fim));
    await s.novoChat();
  } finally { await tmp.limpar(); }
});

test('agente sem encerramento confirmado nao duplica instancia e libera apos finalizar', async () => {
  const tmp = await temporario();
  let liberar!: () => void;
  try {
    const s = new Sala('s', null, 'Sala', await banco(tmp.pasta), {cancelamentoMs:20,limpezaMs:30});
    let iniciou!: () => void;
    const inicio = new Promise<void>((resolve) => { iniciou = resolve; });
    const espera = new Promise<void>((resolve) => { liberar = resolve; });
    let chamadas = 0;
    s.registrar(provedor('codex', async () => { chamadas++; if(chamadas===1) { iniciou(); await espera; } }));
    await s.iniciar();
    s.enviar('@codex executar', []); await inicio;
    s.parar(); await s.esperar();
    s.enviar('@codex novamente', []); await s.esperar();
    assert.equal(chamadas, 1);
    assert.equal(s.provedores.get('codex')!.agente.estado, 'travado');
    liberar(); await new Promise((resolve) => setTimeout(resolve, 10));
    s.enviar('@codex continuar', []); await s.esperar();
    assert.equal(chamadas, 2);
  } finally { liberar?.(); await tmp.limpar(); }
});

test('turno orfao invalida cursor do agente e proxima mensagem recebe historico atual', async () => {
  const tmp = await temporario();
  try {
    const db = await banco(tmp.pasta);
    const s = new Sala('s', null, 'Sala', db);
    s.registrar(provedor('codex', async (_, e) => { e.sessao('sessao-antiga'); e.fala('resposta anterior'); }));
    await s.iniciar();
    s.enviar('@codex primeira', []); await s.esperar();
    assert.ok(s.provedores.get('codex')!.agente.temSessao);
    await db.gravarDoChat('acoes', s.chat.id, 'turno:abandonado', {
      id:'abandonado', agente:'codex', autor:'Codex', registroTurno:true, inicio:new Date(Date.now()+100).toISOString(),
      donoPid:process.pid,instancia:'instancia-encerrada',
    });
    let pedido: any;
    const nova = new Sala('s', null, 'Sala', db);
    nova.registrar(provedor('codex', async (p,e) => {pedido=p;e.fala('resposta atual');}));
    await nova.iniciar();
    assert.equal(nova.provedores.get('codex')!.agente.temSessao,false);
    nova.enviar('@codex pergunta atual', []); await nova.esperar();
    assert.equal(pedido.sessao,undefined);
    assert.match(pedido.prompt,/primeira/);
    assert.match(pedido.prompt,/pergunta atual/);
  } finally { await tmp.limpar(); }
});

test('timeout ativo libera agente que ignora sinal sem reiniciar instancia pendente', async () => {
  const tmp = await temporario();
  let liberar!: () => void;
  try {
    const s = new Sala('s', null, 'Sala', await banco(tmp.pasta), {cancelamentoMs:20,limpezaMs:30});
    const espera = new Promise<void>((resolve) => { liberar=resolve; });
    let chamadas=0;
    s.registrar(provedor('codex', async () => {chamadas++; await espera;}));
    await s.iniciar();
    s.config.timeoutMinutos = 0;
    const sincronizar = s.sincronizarGlobal.bind(s);
    s.sincronizarGlobal = async () => {};
    s.enviar('@codex prazo', []);
    await s.esperar();
    assert.equal(chamadas,1);
    assert.equal(s.provedores.get('codex')!.agente.estado,'travado');
    assert.ok(s.estado().turnos?.every((t) => t.fim));
    s.sincronizarGlobal = sincronizar;
  } finally { liberar?.(); await tmp.limpar(); }
});
