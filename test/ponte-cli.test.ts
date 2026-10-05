import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { access, writeFile, readFile, mkdir } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { PonteHttp } from '../src/mcp/ponte';
import { ProvedorCli, montarArgumentos, type CliId } from '../src/providers/cli';
import { Portao } from '../src/permissions/portao';
import { configuracaoPadrao } from '../src/core/configuracao';
import { montarContexto } from '../src/core/contexto';
import { agentePadrao, type PedidoExecucao } from '../src/providers/tipos';
import { chamarPonte } from '../src/mcp/cliente-ponte';
import type { DoHost, ModoAgente, NivelPermissao } from '../src/shared/protocolo';
import { temporario } from './apoio';

for (const nivel of ['manual', 'parcial', 'total'] as NivelPermissao[])
  for (const modo of ['leitura', 'escrita', 'leitura_escrita'] as ModoAgente[])
    test(`Codex MCP approve somente para servidor proprio: ${nivel}/${modo}, iniciar e retomar`, () => {
      for (const sessao of [undefined, 'thread']) {
        const args = montarArgumentos(
          'codex',
          modo,
          nivel,
          sessao,
          undefined,
          undefined,
          undefined,
          [{ nome: 'herdado', enabled: true, transporte: { command: 'node', args: [] } }],
        );
        assert(args.includes('approval_policy="never"'));
        assert(
          args.includes('mcp_servers.fagulha_orquestrador.default_tools_approval_mode="approve"'),
        );
        assert(args.includes('mcp_servers={"herdado"={command="node",args=[],enabled=false}}'));
        assert(!args.some((a) => /herdado.*approval_mode/.test(a)));
      }
    });

// O launcher limita o env exatamente como os CLIs: whitelist do Codex e env
// declarado/expandido de Claude e Gemini. O servidor e a ponte sao processos reais.
for (const id of ['claude', 'codex', 'gemini'] as CliId[])
  test(`${id}: servidor stdio recebe o env declarado, chega a ponte e ao cartao`, async () => {
    const tmp = await temporario();
    const eventos: DoHost[] = [];
    let portao: Portao;
    portao = new Portao(
      configuracaoPadrao,
      (e) => {
        eventos.push(e);
        if (e.tipo === 'aprovacao') queueMicrotask(() => portao.responder(e.pedido.id, 'aprovar'));
      },
      async () => {},
    );
    const chamadas: string[] = [];
    const ponte = new PonteHttp(async (agente, nome, _, sinal) => {
      chamadas.push(nome);
      return portao.executar(
        {
          agente,
          modo: 'leitura_escrita',
          categoria: 'leitura_workspace',
          resumo: 'Ler conversa',
          detalhe: 'Sala sintetica',
        },
        async () => [{ texto: 'SALA DE TESTE' }],
        sinal,
      );
    });
    await ponte.iniciar();
    const capacidade = ponte.criar(id, new AbortController().signal);
    try {
      const mock = join(tmp.pasta, 'cli.cjs'),
        registro = join(tmp.pasta, 'resultado.json');
      await writeFile(
        mock,
        `
   const fs=require('fs');const args=process.argv.slice(2);
   if(args.includes('--version')){console.log('fixture 1');process.exit(0);}
   if(args[0]==='mcp'){console.log('[]');process.exit(0);}
   (async()=>{
    let cfg, env={};
    if(${JSON.stringify(id)}==='codex'){
     const campo=args.find(a=>a.startsWith('mcp_servers.fagulha_orquestrador.env_vars='));
     for(const nome of JSON.parse(campo.slice(campo.indexOf('=')+1))) env[nome]=process.env[nome];
     cfg={command:process.execPath,args:[${JSON.stringify(resolve('dist/mcp-servidor.js'))}]};
    }else{
     const arquivo=${JSON.stringify(id)}==='claude'?args[args.indexOf('--mcp-config')+1]:process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH;
     cfg=JSON.parse(fs.readFileSync(arquivo,'utf8')).mcpServers.fagulha_orquestrador;
     for(const [nome,valor] of Object.entries(cfg.env)) env[nome]=valor.startsWith('$'+'{')?process.env[valor.slice(2,-1)]:valor;
     if(JSON.stringify(cfg).includes(process.env.ORQUESTRA_BRIDGE_TOKEN)) throw Error('token gravado na configuracao');
    }
    const {Client}=require(${JSON.stringify(require.resolve('@modelcontextprotocol/sdk/client/index.js'))});
    const {StdioClientTransport}=require(${JSON.stringify(require.resolve('@modelcontextprotocol/sdk/client/stdio.js'))});
    const cliente=new Client({name:'fixture',version:'1'});
    try{await cliente.connect(new StdioClientTransport({...cfg,env,stderr:'pipe'}));
     const resposta=await cliente.callTool({name:'sala_ler',arguments:{}});
     fs.writeFileSync(${JSON.stringify(registro)},JSON.stringify(resposta));
    }finally{await cliente.close();}
   })().catch(()=>{process.exitCode=1;});
  `,
      );
      const p = new ProvedorCli(id, async () => {}, mock, join(tmp.pasta, 'scratch'), {
        get: async () => 'fixture-google-em-memoria',
        store: async () => {},
      });
      assert.equal((await p.detectar()).instalado, true);
      const pedido: PedidoExecucao = {
        prompt: 'fixture',
        projeto: tmp.pasta,
        modo: 'leitura_escrita',
        nivel: 'manual',
        ponte: {
          ...capacidade,
          servidor: resolve('dist/mcp-servidor.js'),
          diretorio: join(tmp.pasta, 'ponte'),
        },
      };
      await p.executar(
        pedido,
        { sessao: () => {}, fala: () => {}, parcial: () => {}, acao: () => {}, erro: () => {} },
        new AbortController().signal,
      );
      const resposta = JSON.parse(await readFile(registro, 'utf8'));
      assert.equal(resposta.isError, undefined);
      assert.deepEqual(JSON.parse(resposta.content[0].text), [{ texto: 'SALA DE TESTE' }]);
      assert.deepEqual(chamadas, ['sala_ler']);
      assert.equal(eventos.filter((e) => e.tipo === 'aprovacao').length, 1);
      assert(!JSON.stringify(eventos).includes(capacidade.token));
      await assert.rejects(access(join(pedido.ponte.diretorio, 'mcp.json')));
      await assert.rejects(access(join(pedido.ponte.diretorio, 'gemini-settings.json')));
    } finally {
      capacidade.revogar();
      await ponte.finalizar();
      await tmp.limpar();
    }
  });

test('servidor sem variaveis, token revogado, argumentos invalidos e recusas tem diagnosticos seguros', async () => {
  const ponte = new PonteHttp(async () => {
    throw Error('detalhe privado sk-' + 'X'.repeat(32));
  });
  await ponte.iniciar();
  const c = ponte.criar('claude', new AbortController().signal);
  const clientes: Client[] = [];
  const conectar = async (env: Record<string, string>) => {
    const cli = new Client({ name: 'fixture', version: '1' });
    clientes.push(cli);
    await cli.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [resolve('dist/mcp-servidor.js')],
        env,
        stderr: 'pipe',
      }),
    );
    return cli;
  };
  try {
    const ausente = await conectar({});
    const faltou = await ausente.callTool({ name: 'sala_ler', arguments: {} });
    assert.equal(faltou.isError, true);
    assert.match((faltou.content as any)[0].text, /Variaveis da ponte ausentes no processo/);
    const invalido = await ausente.callTool({
      name: 'sala_ler',
      arguments: { texto: 'nao permitido' },
    });
    assert.match((invalido.content as any)[0].text, /Argumentos invalidos/);
    const conectado = await conectar({
      ORQUESTRA_BRIDGE_URL: c.url,
      ORQUESTRA_BRIDGE_TOKEN: c.token,
    });
    const falhou = await conectado.callTool({ name: 'sala_ler', arguments: {} });
    assert.match((falhou.content as any)[0].text, /falhou no host/);
    assert(!JSON.stringify(falhou).includes('sk-'));
    c.revogar();
    const revogado = await conectado.callTool({ name: 'sala_ler', arguments: {} });
    assert.match((revogado.content as any)[0].text, /Ponte recusou o token \(execucao encerrada\)/);
    assert(!JSON.stringify(revogado).includes(c.token));
  } finally {
    for (const cli of clientes) await cli.close();
    await ponte.finalizar();
  }
});

for (const decisao of ['negar', 'expirar', 'cancelar', 'modo'] as const)
  test(`diagnostico do Portao: ${decisao}`, async () => {
    const config = configuracaoPadrao(),
      controle = new AbortController();
    let portao: Portao;
    portao = new Portao(
      () => config,
      (e) => {
        if (e.tipo === 'aprovacao') {
          if (decisao === 'negar') queueMicrotask(() => portao.responder(e.pedido.id, 'negar'));
          if (decisao === 'cancelar') queueMicrotask(() => controle.abort());
        }
      },
      async () => {},
      10,
    );
    const ponte = new PonteHttp(async () =>
      portao.executar(
        {
          agente: 'codex',
          modo: decisao === 'modo' ? 'leitura' : 'leitura_escrita',
          categoria: 'escrita_workspace',
          resumo: 'Escrever',
          detalhe: 'teste',
        },
        async () => {
          throw Error('efeito proibido');
        },
        controle.signal,
      ),
    );
    await ponte.iniciar();
    const c = ponte.criar('codex', new AbortController().signal);
    try {
      const esperado = {
        negar: 'Acao negada pelo usuario',
        expirar: 'cartao de aprovacao expirou',
        cancelar: 'Execucao encerrada',
        modo: 'recusada pelo modo',
      }[decisao];
      await assert.rejects(
        chamarPonte(
          'sala_ler',
          {},
          { ORQUESTRA_BRIDGE_URL: c.url, ORQUESTRA_BRIDGE_TOKEN: c.token },
        ),
        new RegExp(esperado),
      );
    } finally {
      c.revogar();
      await ponte.finalizar();
    }
  });

for (const etapa of ['cli', 'chave_ausente', 'aborto', 'descoberta_codex'] as const)
  test(`configuracoes efemeras limpas na falha ${etapa}`, async () => {
    const tmp = await temporario();
    try {
      const mock = join(tmp.pasta, 'falha.cjs');
      await writeFile(
        mock,
        `if(process.argv.includes('--version')){console.log('fixture');}else{process.exit(1);}`,
      );
      const id =
        etapa === 'chave_ausente' ? 'gemini' : etapa === 'descoberta_codex' ? 'codex' : 'claude';
      const p = new ProvedorCli(id, async () => {}, mock);
      await p.detectar();
      const pedido: PedidoExecucao = {
        prompt: 'fixture',
        projeto: tmp.pasta,
        modo: 'leitura',
        nivel: 'manual',
        ponte: {
          url: 'http://127.0.0.1:1',
          token: 'fixture-ponte-apenas',
          servidor: 'fixture.js',
          diretorio: join(tmp.pasta, 'ponte'),
        },
      };
      const c = new AbortController();
      if (etapa === 'aborto') c.abort();
      await assert.rejects(
        p.executar(
          pedido,
          { sessao: () => {}, fala: () => {}, parcial: () => {}, acao: () => {}, erro: () => {} },
          c.signal,
        ),
      );
      for (const f of ['mcp.json', 'gemini-settings.json'])
        await assert.rejects(access(join(pedido.ponte.diretorio, f)));
    } finally {
      await tmp.limpar();
    }
  });

test('contexto ensina ferramentas e cartao sem inventar configuracao do usuario', () => {
  const a = agentePadrao('codex', 'Codex', 'cli', 'verde');
  const texto = montarContexto({
    agente: a,
    agentes: [a],
    config: configuracaoPadrao(),
    projeto: null,
    historico: [],
    regras: [],
    anexos: [],
    contextos: [],
  });
  for (const nome of [
    'navegador_ler',
    'navegador_abrir',
    'arquivo_ler',
    'arquivo_escrever',
    'comando_executar',
    'fagulha_orquestrador',
    'cartao de aprovacao',
    'Manual, Parcial e Total',
    'nao existe configuracao ask/never',
  ])
    assert(texto.includes(nome));
});
