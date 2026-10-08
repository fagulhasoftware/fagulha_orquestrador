import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { temporario, banco } from './apoio';
import { Sala } from '../src/core/sala';
import { agentePadrao } from '../src/providers/tipos';
import { Anexador } from '../src/attachments/pipeline';
import { imagensNativas } from '../src/attachments/nativas';
import { lerImagem, eConteudoImagem } from '../src/attachments/imagem';
import { ExecutorFerramentas } from '../src/mcp/executor';
import { PonteHttp } from '../src/mcp/ponte';
import { chamarPonte } from '../src/mcp/cliente-ponte';
import { validarArgumentos } from '../src/mcp/ferramentas';
import { ErroFerramenta } from '../src/mcp/erros';
import { horarioLocal, exportarMarkdown } from '../src/core/horario';
import { ProvedorCli, type CliId } from '../src/providers/cli';
import { protegerSegredo } from '../src/core/seguranca';
import type { NivelPermissao } from '../src/shared/protocolo';

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=';
const pergunta = {
  perguntas: [{ id: 'q', pergunta: 'Escolha', opcoes: [{ rotulo: 'A' }, { rotulo: 'B' }] }],
};
async function fixture(pasta: string) {
  const sala = new Sala('s', pasta, 'Teste', await banco(pasta));
  const a = agentePadrao('codex', 'Codex', 'cli', 'verde');
  a.instalado = a.habilitado = true;
  sala.registrar({
    agente: a,
    detectar: async () => ({ instalado: true }),
    estadoLogin: async () => 'conectado',
    login: async () => {},
    executar: async () => {},
  });
  await sala.iniciar();
  const ex = new ExecutorFerramentas(sala, [pasta], async () => {});
  return { sala, ex, sinal: new AbortController().signal };
}

test('anexos_listar aceita argumentos vazios, omitidos e null, mas rejeita extras; erro de id especifico', () => {
  for (const entrada of [{}, undefined, null])
    assert.deepEqual(validarArgumentos('anexos_listar', entrada), {});
  assert.throws(() => validarArgumentos('anexos_listar', { extra: 1 }), /Argumento desconhecido/);
  assert.throws(() => validarArgumentos('anexo_ler', {}), /Argumento obrigatorio: id/);
});

for (const nivel of ['manual', 'parcial', 'total'] as NivelPermissao[])
  test(`imagens coladas, arrastadas e do projeto atraves do Portao: ${nivel}`, async () => {
    const tmp = await temporario();
    try {
      const { sala, ex, sinal } = await fixture(tmp.pasta);
      sala.config.nivel = nivel;
      let cartoes = 0;
      sala.observar((e) => {
        if (e.tipo === 'aprovacao') {
          cartoes++;
          queueMicrotask(() => sala.portao.responder(e.pedido.id, 'aprovar'));
        }
      });
      const anexador = new Anexador(
        join(tmp.pasta, 'objetos'),
        resolve('dist/anexos-worker.js'),
        () => sala.config.limites,
      );
      const caminho = join(tmp.pasta, 'projeto.png');
      await writeFile(caminho, Buffer.from(png, 'base64'));
      const colada = await anexador.dados('image.png', png);
      const arrastada = await anexador.arquivo(caminho);
      await sala.adicionarAnexo(colada);
      await sala.adicionarAnexo(arrastada);
      sala.enviar('Duas imagens', [colada.meta.id, arrastada.meta.id]);
      for (const [nome, args] of [
        ['anexo_ler', { id: colada.meta.id }],
        ['anexo_ler', { id: 'projeto.png' }],
        ['arquivo_ler', { caminho }],
      ] as const) {
        const r = await ex.executar('codex', nome, args, sinal);
        assert(eConteudoImagem(r));
        const imagem = r.conteudoMcp.find((c) => c.type === 'image')!;
        assert.equal(imagem.type, 'image');
        if (imagem.type === 'image') {
          assert.equal(imagem.data, png);
          assert.equal(imagem.mimeType, 'image/png');
        }
      }
      assert.equal(cartoes, nivel === 'manual' ? 3 : 0);
      assert(!sala.mensagens.some((m) => m.texto.includes(png)));
      const nativas = await imagensNativas(
        [colada, arrastada],
        nivel,
        join(tmp.pasta, 'execucao'),
        10,
      );
      assert.equal(nativas.length, nivel === 'manual' ? 0 : 2);
      for (const n of nativas) assert.equal((await readFile(n)).toString('base64'), png);
      await sala.esperar();
    } finally {
      await tmp.limpar();
    }
  });

test('nomes ambiguos, anexos de outro chat, imagem invalida/grande e recusa nao vazam dados', async () => {
  const tmp = await temporario();
  try {
    const { sala, ex, sinal } = await fixture(tmp.pasta);
    sala.config.nivel = 'total';
    const anexador = new Anexador(
      join(tmp.pasta, 'objetos'),
      resolve('dist/anexos-worker.js'),
      () => sala.config.limites,
    );
    const a = await anexador.dados('image.png', png),
      b = await anexador.dados('image.png', png);
    await sala.adicionarAnexo(a);
    await sala.adicionarAnexo(b);
    sala.enviar('Imagens', [a.meta.id, b.meta.id]);
    await assert.rejects(
      ex.executar('codex', 'anexo_ler', { id: 'image.png' }, sinal),
      /ambiguo.*ids/,
    );
    await assert.rejects(
      ex.executar('codex', 'anexo_ler', { id: 'ausente' }, sinal),
      /ids disponiveis/,
    );
    sala.anexos.set('outro-chat', { ...a, meta: { ...a.meta, id: 'outro-chat' } });
    await assert.rejects(
      ex.executar('codex', 'anexo_ler', { id: 'outro-chat' }, sinal),
      /outro chat/,
    );
    const grande = join(tmp.pasta, 'grande.png');
    await writeFile(grande, Buffer.alloc(10 * 1024 * 1024 + 1));
    await assert.rejects(lerImagem(grande), /maior que o limite/);
    const falso = join(tmp.pasta, 'falso.png');
    await writeFile(falso, 'texto');
    await assert.rejects(lerImagem(falso), /nao suportado/);
    sala.config.nivel = 'manual';
    sala.observar((e) => {
      if (e.tipo === 'aprovacao') queueMicrotask(() => sala.portao.responder(e.pedido.id, 'negar'));
    });
    await assert.rejects(ex.executar('codex', 'anexo_ler', { id: a.meta.id }, sinal));
    await sala.esperar();
  } finally {
    await tmp.limpar();
  }
});

test('MCP stdio real entrega bloco image e preserva erros previstos sem expor excecoes internas', async () => {
  const tmp = await temporario();
  const controle = new AbortController();
  let ponte: PonteHttp | undefined;
  let cliente: Client | undefined;
  try {
    const { sala, ex } = await fixture(tmp.pasta);
    sala.config.nivel = 'total';
    const anexador = new Anexador(
      join(tmp.pasta, 'objetos'),
      resolve('dist/anexos-worker.js'),
      () => sala.config.limites,
    );
    const a = await anexador.dados('image.png', png);
    await sala.adicionarAnexo(a);
    sala.enviar('Imagem', [a.meta.id]);
    ponte = new PonteHttp((id, nome, args, sinal) => ex.executar(id, nome, args, sinal));
    await ponte.iniciar();
    const cap = ponte.criar('codex', controle.signal);
    const env = { ORQUESTRA_BRIDGE_URL: cap.url, ORQUESTRA_BRIDGE_TOKEN: cap.token };
    cliente = new Client({ name: 'teste', version: '1' });
    await cliente.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [resolve('dist/mcp-servidor.js')],
        env,
      }),
    );
    const r = await cliente.callTool({ name: 'anexo_ler', arguments: { id: 'image.png' } });
    assert(!r.isError);
    assert((r.content as any[]).some((c) => c.type === 'image' && c.data === png));
    const erro = await cliente.callTool({ name: 'anexo_ler', arguments: { id: 'ausente' } });
    assert.equal(erro.isError, true);
    assert.match(JSON.stringify(erro.content), /ids disponiveis/);
    await assert.rejects(chamarPonte('anexo_ler', {}, env), /Argumento obrigatorio: id/);
    assert(Array.isArray(await chamarPonte('anexos_listar', null, env)));
    await sala.esperar();
  } finally {
    controle.abort();
    await cliente?.close();
    await ponte?.finalizar();
    await tmp.limpar();
  }
});

for (const decisao of ['responder', 'pular'] as const)
  test(`pergunta pendente retém fila e rejeita envio; ${decisao} libera outro agente`, async () => {
    const tmp = await temporario();
    let sala: Sala | undefined;
    try {
      ({ sala } = await fixture(tmp.pasta));
      let executou = false;
      const agente = agentePadrao('claude', 'Claude', 'cli', 'amarelo');
      agente.habilitado = agente.instalado = true;
      sala.registrar({
        agente,
        detectar: async () => ({ instalado: true }),
        estadoLogin: async () => 'conectado',
        login: async () => {},
        executar: async () => {
          executou = true;
        },
      });
      const espera = sala.perguntas.perguntar('codex', pergunta, new AbortController().signal);
      while (!sala.perguntas.pendentes.size) await new Promise((r) => setImmediate(r));
      sala.acionar('claude');
      await new Promise((r) => setImmediate(r));
      assert.equal(executou, false);
      assert.equal(agente.estado, 'na_fila');
      const antes = sala.mensagens.length;
      assert.throws(() => sala!.enviar('@claude nova mensagem', []), /pergunta pendente/);
      assert.equal(sala.mensagens.length, antes);
      const id = [...sala.perguntas.pendentes.keys()][0];
      if (decisao === 'responder') sala.perguntas.responder(id, [{ id: 'q', opcoes: ['A'] }]);
      else sala.perguntas.cancelar(id);
      await espera;
      await new Promise((r) => setImmediate(r));
      await sala.esperar();
      assert.equal(executou, true);
    } finally {
      sala?.parar();
      await sala?.esperar();
      await tmp.limpar();
    }
  });

test('horario local e exportacao mantem virada de dia em Sao Paulo, Berlin e UTC', () => {
  const iso = '2026-10-08T01:30:00.000Z';
  assert.match(horarioLocal(iso, 'America/Sao_Paulo', 'pt-BR'), /07\/10\/2026.*22:30/);
  assert.match(horarioLocal(iso, 'Europe/Berlin', 'pt-BR'), /08\/10\/2026.*03:30/);
  assert.match(horarioLocal(iso, 'UTC', 'pt-BR'), /08\/10\/2026.*01:30/);
  const m = {
    id: 'm',
    sala: 's',
    autor: 'Codex',
    tipo: 'fala' as const,
    quando: iso,
    texto: 'Resposta',
  };
  assert.match(exportarMarkdown([m], 'America/Sao_Paulo', 'pt-BR'), /07\/10\/2026.*22:30/);
  assert.equal(m.quando, iso);
  const anterior = process.env.TZ;
  try {
    for (const fuso of ['America/Sao_Paulo', 'Europe/Berlin', 'UTC']) {
      process.env.TZ = fuso;
      assert.equal(horarioLocal(iso, undefined, 'pt-BR'), horarioLocal(iso, fuso, 'pt-BR'));
    }
  } finally {
    if (anterior === undefined) delete process.env.TZ;
    else process.env.TZ = anterior;
  }
});

test('contexto do agente informa id, nome, tipo, bytes e tratamento dos anexos', async () => {
  const tmp = await temporario();
  try {
    const { sala } = await fixture(tmp.pasta);
    sala.config.nivel = 'total';
    let prompt = '';
    sala.provedores.get('codex')!.executar = async (pedido) => {
      prompt = pedido.prompt;
    };
    const anexador = new Anexador(
      join(tmp.pasta, 'objetos'),
      resolve('dist/anexos-worker.js'),
      () => sala.config.limites,
    );
    const a = await anexador.dados('print.png', png);
    await sala.adicionarAnexo(a);
    sala.enviar('@codex leia a imagem', [a.meta.id]);
    await sala.esperar();
    for (const trecho of [
      a.meta.id,
      'print.png',
      'tipo=imagem',
      `bytes=${a.meta.bytes}`,
      'tratamento=integral',
      'anexo_ler',
    ])
      assert(prompt.includes(trecho));
  } finally {
    await tmp.limpar();
  }
});

for (const id of ['codex', 'claude', 'gemini'] as CliId[])
  test(`${id}: imagens nativas em nova sessao e retomada, nunca no Manual`, async () => {
    const tmp = await temporario();
    try {
      const registro = join(tmp.pasta, 'registro.json'),
        bin = join(tmp.pasta, 'cli.cjs');
      await writeFile(
        bin,
        `const fs=require('fs'),a=process.argv.slice(2); if(a.includes('--version')){console.log('fixture');process.exit(0);}if(a[0]==='mcp'){console.log('[]');process.exit(0);}let s='';process.stdin.on('data',b=>s+=b);process.stdin.on('end',()=>{fs.writeFileSync(${JSON.stringify(registro)},JSON.stringify({args:a,stdin:s}));console.log(JSON.stringify({type:'init',session_id:'teste'}));});`,
      );
      const p = new ProvedorCli(id, async () => {}, bin, join(tmp.pasta, 'scratch'), {
        get: async () => 'chave-ficticia',
        store: async () => {},
      });
      await p.detectar();
      const imagem = join(tmp.pasta, 'imagem com espaco.png');
      await writeFile(imagem, Buffer.from(png, 'base64'));
      for (const nivel of ['manual', 'parcial', 'total'] as NivelPermissao[])
        for (const sessao of [undefined, 'retomada']) {
          const prompt =
            nivel === 'manual' ? 'Use anexo_ler.' : `Leia imagem: ${JSON.stringify(imagem)}`;
          await p.executar(
            {
              prompt,
              projeto: tmp.pasta,
              modo: 'leitura_escrita',
              nivel,
              sessao,
              caminhosImagens: [imagem],
              ponte: {
                url: 'http://127.0.0.1:1/ferramenta',
                token: 'teste',
                servidor: 'servidor.js',
                diretorio: join(tmp.pasta, 'ponte'),
              },
            },
            { acao: () => {}, fala: () => {}, parcial: () => {}, erro: () => {}, sessao: () => {} },
            new AbortController().signal,
          );
          const log = JSON.parse(await readFile(registro, 'utf8'));
          if (id === 'codex') {
            assert.equal(log.args.includes('-i'), nivel !== 'manual');
            if (nivel !== 'manual') assert.equal(log.args[log.args.indexOf('-i') + 1], imagem);
          }
          if (id === 'gemini')
            assert.equal(log.stdin.includes(`@${JSON.stringify(imagem)}`), nivel !== 'manual');
          if (id === 'claude')
            assert.equal(log.stdin.includes(imagem.replace(/\\/g, '\\\\')), nivel !== 'manual');
        }
    } finally {
      await tmp.limpar();
    }
  });

test('ponte informa somente erros previstos e mascara segredos', async () => {
  const segredo = 'segredo-de-fixture-nao-e-chave-real';
  protegerSegredo(segredo);
  const ponte = new PonteHttp(async (_id, nome) => {
    if (nome === 'anexos_listar') throw new ErroFerramenta(`Anexo indisponivel ${segredo}`);
    throw new Error(`Detalhe interno e caminho privado ${segredo}`);
  });
  await ponte.iniciar();
  const cap = ponte.criar('codex', new AbortController().signal);
  const env = { ORQUESTRA_BRIDGE_URL: cap.url, ORQUESTRA_BRIDGE_TOKEN: cap.token };
  try {
    await assert.rejects(
      chamarPonte('anexos_listar', {}, env),
      (e: any) => /Anexo indisponivel/.test(e.message) && !e.message.includes(segredo),
    );
    await assert.rejects(
      chamarPonte('sala_ler', {}, env),
      (e: any) => !/Detalhe interno|caminho privado/.test(e.message),
    );
  } finally {
    await ponte.finalizar();
  }
});
