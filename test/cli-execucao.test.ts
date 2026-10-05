import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { ProvedorCli, type CliId } from '../src/providers/cli';
import type { EventosProvedor, PedidoExecucao } from '../src/providers/tipos';
import { temporario } from './apoio';

for (const id of ['claude', 'codex', 'gemini'] as CliId[]) {
  test(`${id}: cwd hibrido, login preservado e ferramentas manuais desligadas`, async () => {
    const tmp = await temporario();
    try {
      const projeto = join(tmp.pasta, 'projeto');
      await mkdir(projeto);
      const mock = join(tmp.pasta, 'cli.cjs');
      const registro = join(tmp.pasta, 'execucao.json');
      await writeFile(
        mock,
        `
        const fs=require('fs');const args=process.argv.slice(2);
        if(args.includes('--version')){console.log('fixture 1.0');process.exit(0);}
        if(args[0]==='mcp'){console.log(JSON.stringify([{name:'herdado',enabled:true,transport:{type:'stdio',command:'node',args:[]}}]));process.exit(0);}
        const settings=process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH;
        const caminhoMcp=args[args.indexOf('--mcp-config')+1];
        fs.writeFileSync(${JSON.stringify(registro)},JSON.stringify({cwd:process.cwd(),args,home:process.env.CODEX_HOME,chaveGeminiPresente:process.env.GEMINI_API_KEY==='fixture-gemini-apenas-em-memoria-0000',mcp:args.includes('--mcp-config')?JSON.parse(fs.readFileSync(caminhoMcp,'utf8')):null,settings:settings?JSON.parse(fs.readFileSync(settings,'utf8')):null}));
        console.log(JSON.stringify({type:'init',session_id:'fixture-sessao'}));
      `,
      );
      const provedor = new ProvedorCli(id, async () => {}, mock, join(tmp.pasta, 'scratch'), {
        get: async () => 'fixture-gemini-apenas-em-memoria-0000',
        store: async () => {},
      });
      assert.equal((await provedor.detectar()).instalado, true);
      const acoes: string[] = [];
      const ev: EventosProvedor = {
        sessao: () => {},
        fala: () => {},
        parcial: () => {},
        erro: () => {},
        acao: (t) => acoes.push(t),
      };
      const pedido: PedidoExecucao = {
        prompt: 'fixture, sem modelo',
        projeto,
        modo: 'leitura_escrita',
        nivel: 'manual',
        ponte: {
          url: 'http://127.0.0.1:1',
          token: 'fixture-nao-secreta',
          servidor: 'fixture.js',
          diretorio: join(tmp.pasta, 'ponte'),
        },
      };
      await provedor.executar(pedido, ev, new AbortController().signal);
      const manual = JSON.parse(await readFile(registro, 'utf8'));
      await assert.rejects(access(join(pedido.ponte.diretorio, 'mcp.json')));
      await assert.rejects(access(join(pedido.ponte.diretorio, 'gemini-settings.json')));
      if (id === 'claude' || id === 'gemini') {
        const servidor = (id === 'claude' ? manual.mcp : manual.settings).mcpServers
          .fagulha_orquestrador;
        assert.equal(servidor.env.ORQUESTRA_BRIDGE_URL, '${ORQUESTRA_BRIDGE_URL}');
        assert.equal(servidor.env.ORQUESTRA_BRIDGE_TOKEN, '${ORQUESTRA_BRIDGE_TOKEN}');
        assert(!JSON.stringify(servidor).includes(pedido.ponte.token));
      }
      assert.notEqual(manual.cwd, projeto);
      assert.equal(manual.home, process.env.CODEX_HOME);
      if (id === 'gemini') {
        assert.deepEqual(manual.settings.tools.core, []);
        assert.equal(manual.settings.security.auth.selectedType, 'gemini-api-key');
        assert.equal(manual.settings.security.auth.enforcedType, 'gemini-api-key');
        assert.equal(manual.chaveGeminiPresente, true);
        assert(!JSON.stringify(manual).includes('fixture-gemini-apenas-em-memoria-0000'));
      }
      pedido.nivel = 'parcial';
      await provedor.executar(pedido, ev, new AbortController().signal);
      const hibrido = JSON.parse(await readFile(registro, 'utf8'));
      assert.equal(hibrido.cwd, projeto);
      assert.equal(hibrido.home, process.env.CODEX_HOME);
      if (id === 'claude') {
        assert(!hibrido.args.includes('--bare'));
        assert(!hibrido.args.includes('--tools'));
      }
      if (id === 'codex')
        assert(
          hibrido.args.includes('mcp_servers={"herdado"={command="node",args=[],enabled=false}}'),
        );
      if (id === 'gemini') {
        assert.equal(hibrido.settings.tools.core, undefined);
        assert(hibrido.settings.tools.exclude.includes('run_shell_command'));
        // Fixture vazia: nunca lemos nem imprimimos conteudo de .env.
        await writeFile(join(projeto, '.env'), '');
        pedido.sessao = 'nova-sessao';
        const antes = acoes.length;
        await provedor.executar(pedido, ev, new AbortController().signal);
        await provedor.executar(pedido, ev, new AbortController().signal);
        assert.equal(acoes.slice(antes).filter((t) => t.startsWith('Aviso:')).length, 1);
      }
    } finally {
      await tmp.limpar();
    }
  });
}
