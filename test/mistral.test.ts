import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { ProvedorMistral } from '../src/providers/mistral';
import { GestorLogin } from '../src/providers/login';
import { temporario } from './apoio';

async function fixture(permitir = true, authState = 'vibe_home_env_file', conclusao: Record<string, string> = {}) {
  const tmp = await temporario(), script = join(tmp.pasta, 'acp.cjs'), log = join(tmp.pasta, 'rpc.ndjson');
  await writeFile(script, `const fs=require('fs'),path=require('path'),home=process.env.VIBE_HOME,marker=path.join(home,'fixture-login');let session='fixture-session',pending;
    const send=v=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...v})+'\\n');
    require('readline').createInterface({input:process.stdin}).on('line',l=>{const j=JSON.parse(l);if(!j.method){if(j.id==='permission'&&pending){const allowed=j.result?.outcome?.optionId==='once';if(allowed)send({method:'session/update',params:{sessionId:session,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'OLA ACP'}}}});send({id:pending,result:{stopReason:allowed?'end_turn':'cancelled'}});}return;}
    fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({method:j.method,home,keyPresent:!!process.env.MISTRAL_API_KEY,keyringIsolated:process.env.PYTHON_KEYRING_BACKEND==='keyring.backends.fail.Keyring',params:j.method==='session/new'?{cwd:j.params.cwd,mcpNames:j.params.mcpServers.map(m=>m.name)}:undefined})+'\\n');
    let result={};if(j.method==='initialize')result={protocolVersion:1,agentInfo:{version:'fixture'},agentCapabilities:{loadSession:true},authMethods:[{id:'browser-auth-delegated'}]};
    else if(j.method==='_auth/status') result={authenticated:fs.existsSync(marker),authState:${JSON.stringify(authState)},customDomain:null};
    else if(j.method==='authenticate'){const meta=j.params._meta;if(!meta||j.params.action!==undefined||j.params.attemptId!==undefined)throw Error('auth extension fields must use _meta');if(meta.action==='start'){if(meta.signInTarget!=='mistral')throw Error('wrong target');result={_meta:{'browser-auth-delegated':{attemptId:'fixture-attempt',signInUrl:'https://console.mistral.ai/auth/login?state=fixture'}}};}else {if(meta.action!=='complete'||meta.attemptId!=='fixture-attempt')throw Error('wrong completion attempt');fs.writeFileSync(marker,'fixture');result={_meta:{'browser-auth-delegated':{attemptId:'fixture-attempt',status:'completed',persistResult:'completed',...${JSON.stringify(conclusao)}}}};}}
    else if(j.method==='_auth/signOut'){fs.rmSync(marker,{force:true});}
    else if(j.method==='session/new')result={sessionId:session};
    else if(j.method==='session/prompt'){
      if(j.params.prompt[0].text==='wait'){send({method:'session/update',params:{sessionId:session,update:{sessionUpdate:'tool_call',title:'started'}}});return;}
      pending=j.id;
      send({id:'permission',method:'session/request_permission',params:{sessionId:session,toolCall:{title:'Fixture tool'},options:[{kind:'allow_once',optionId:'once'}]}});
      return;
    }
    send({id:j.id,result});});`);
  const cofre = new Map<string, string>();
  const segredos = { get: async (k: string) => cofre.get(k), store: async (k: string, v: string) => { cofre.set(k, v); }, delete: async (k: string) => { cofre.delete(k); } };
  const p = new ProvedorMistral('mistral-vibe', join(tmp.pasta, 'vibe-conta'), segredos, () => ({ comando: script }), async () => permitir);
  return { tmp, p, segredos, log, script };
}

test('Vibe ACP: login nativo, status, sessao, resposta, MCP e logout separados da API', async () => {
  const f = await fixture();
  const antigo = process.env.MISTRAL_API_KEY;
  process.env.MISTRAL_API_KEY = 'fixture-ambient-key';
  try {
    assert.equal((await f.p.detectar()).instalado, true);
    assert.equal(await f.p.estadoLogin(), 'desconectado');
    const urls: string[] = [], eventos: any[] = [];
    const gestor = new GestorLogin({ provedor: () => f.p, emitir: e => eventos.push(e), abrir: async u => { urls.push(u); }, auditar: async () => {} });
    await gestor.iniciar('mistral-vibe', 'navegador');
    assert.equal(f.p.agente.login, 'conectado');
    assert.equal(urls.length, 1);
    assert(!JSON.stringify(eventos).includes('fixture-ambient-key'));
    const falas: string[] = [], parciais: string[] = [];
    const pedido = { prompt: 'fixture', projeto: f.tmp.pasta, modo: 'leitura_escrita' as const, nivel: 'total' as const, ponte: { url: 'http://127.0.0.1:1', token: 'fixture', servidor: 'fixture.js', diretorio: f.tmp.pasta } };
    await f.p.executar(pedido, { sessao: () => {}, fala: t => falas.push(t), parcial: t => parciais.push(t), acao: () => {}, erro: () => {} }, new AbortController().signal);
    assert.deepEqual(falas, ['OLA ACP']); assert.deepEqual(parciais, ['OLA ACP']);
    const log = (await readFile(f.log, 'utf8')).trim().split('\n').map(l => JSON.parse(l));
    assert(log.every(l => !l.keyPresent && l.keyringIsolated));
    assert(log.filter(l => l.method === 'session/new').every(l => l.params.mcpNames[0] === 'fagulha_orquestrador'));
    assert.equal(process.env.MISTRAL_API_KEY, 'fixture-ambient-key');
    await gestor.logout('mistral-vibe');
    assert.equal(await f.p.estadoLogin(), 'desconectado');
    await assert.rejects(f.p.executar(pedido, {sessao:()=>{},fala:()=>{},parcial:()=>{},acao:()=>{},erro:()=>{}}, new AbortController().signal), /Nenhuma chave/);
    await gestor.finalizar();
  } finally { if (antigo === undefined) delete process.env.MISTRAL_API_KEY; else process.env.MISTRAL_API_KEY = antigo; await f.tmp.limpar(); }
});

test('Enterprise e Vibe preservam perfis distintos; niveis restritos recusados antes de iniciar', async () => {
  const f = await fixture();
  try {
    const empresa = new ProvedorMistral('mistral-enterprise', join(f.tmp.pasta, 'enterprise-conta'), f.segredos, () => ({ comando: f.script }));
    assert.deepEqual(empresa.agente.apelidos, ['mistralcode']);
    assert.equal(empresa.agente.autenticacaoModo, 'empresa');
    assert.equal((await empresa.detectar()).instalado, true);
    assert.equal(await empresa.estadoLogin(), 'desconectado');
    const antes = await readFile(f.log, 'utf8');
    await assert.rejects(empresa.executar({ prompt:'fixture',projeto:f.tmp.pasta,modo:'leitura',nivel:'manual',ponte:{url:'',token:'',servidor:'',diretorio:''}}, {sessao:()=>{},fala:()=>{},parcial:()=>{},acao:()=>{},erro:()=>{}},new AbortController().signal), /Total/);
    assert.equal(await readFile(f.log, 'utf8'), antes);
    await assert.rejects(access(join(f.tmp.pasta, 'enterprise-conta', 'fixture-login')));
  } finally { await f.tmp.limpar(); }
});

test('ACP recusa permissao e aborta prompt pendente encerrando o processo', async () => {
  const f = await fixture(false);
  try {
    await f.p.detectar();
    const gestor = new GestorLogin({provedor:()=>f.p,emitir:()=>{},abrir:async()=>{},auditar:async()=>{}});
    await gestor.iniciar('mistral-vibe','navegador');
    const pedido = {prompt:'fixture',projeto:f.tmp.pasta,modo:'leitura_escrita' as const,nivel:'total' as const,ponte:{url:'http://127.0.0.1:1',token:'fixture',servidor:'fixture.js',diretorio:f.tmp.pasta}};
    const ev = {sessao:()=>{},fala:()=>{},parcial:()=>{},acao:()=>{},erro:()=>{}};
    await assert.rejects(f.p.executar(pedido,ev,new AbortController().signal), /interrompeu/);
    const controle = new AbortController();
    let iniciou!: () => void;
    const pronto = new Promise<void>(r=>iniciou=r);
    const tarefa = f.p.executar({...pedido,prompt:'wait'},{...ev,acao:t=>{if(t==='started')iniciou();}},controle.signal);
    await pronto;
    controle.abort();
    await assert.rejects(tarefa, /interrompida/);
    await gestor.finalizar();
  } finally { await f.tmp.limpar(); }
});

for (const fonte of ['os_keyring','process_env']) test(`Mistral recusa credencial fora do perfil mesmo autenticado: ${fonte}`, async () => {
  const f = await fixture(true,fonte);
  try {
    await f.p.detectar();
    const eventos: any[]=[];
    const gestor = new GestorLogin({provedor:()=>f.p,emitir:e=>eventos.push(e),abrir:async()=>{},auditar:async()=>{}});
    await gestor.iniciar('mistral-vibe','navegador');
    assert(eventos.some(e=>e.tipo==='login'&&e.progresso.etapa==='erro'));
    assert.equal(await f.p.estadoLogin(),'desconectado');
    await gestor.finalizar();
  } finally { await f.tmp.limpar(); }
});

for (const [conclusao, mensagem] of [
  [{attemptId:'outra-tentativa'}, /tentativa original/],
  [{persistResult:'save_error'}, /salvar o login/],
] as const) test('login Mistral exige tentativa correta e persistencia confirmada: '+JSON.stringify(conclusao), async () => {
  const f = await fixture(true,'vibe_home_env_file',conclusao);
  try {
    await f.p.detectar();
    const eventos: any[]=[];
    const gestor = new GestorLogin({provedor:()=>f.p,emitir:e=>eventos.push(e),abrir:async()=>{},auditar:async()=>{}});
    await gestor.iniciar('mistral-vibe','navegador');
    assert(eventos.some(e=>e.tipo==='login'&&e.progresso.etapa==='erro'&&mensagem.test(e.progresso.mensagem)));
    assert(!eventos.some(e=>e.tipo==='login'&&e.progresso.etapa==='conectado'));
    await gestor.finalizar();
  } finally { await f.tmp.limpar(); }
});
