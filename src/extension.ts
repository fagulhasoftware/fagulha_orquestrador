import * as vscode from 'vscode';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { exportarMarkdown } from './core/horario';
import { mkdir, readFile, writeFile, rm, stat, open } from 'node:fs/promises';
import { Armazenamento } from './storage/sqlite';
export { Armazenamento } from './storage/sqlite';
import { Sala, chaveSala } from './core/sala';
import { validarMensagem } from './core/protocolo';
import { montarHtml } from './core/webview';
import { mascarar, caminhoReal, protegerSegredo } from './core/seguranca';
import { ProvedorCli } from './providers/cli';
import { ProvedorApi, type ApiId, type OpcoesApi } from './providers/api';
import { GestorLogin } from './providers/login';
import type { Provedor } from './providers/tipos';
import { carregarManifestos, lerManifesto, criarProvedorManifesto } from './providers/manifestos';
import { PonteHttp } from './mcp/ponte';
import { ExecutorFerramentas } from './mcp/executor';
import { Integracoes } from './integrations/gestor';
import { mensagemIntegracao } from './integrations/mensagens';
import { ferramentas } from './mcp/ferramentas';
import type { RegistroIntegracao } from './integrations/tipos';
import { Anexador } from './attachments/pipeline';
import { imagensNativas } from './attachments/nativas';
import { lerImagem } from './attachments/imagem';
import {
  descobrirContextos,
  importarContexto,
  type CandidatoContexto,
} from './context-import/importador';
import { VozLocal } from './voice/voz';
import { validarUrl } from './browser/pagina';
import type { DoHost, Agente, Mensagem, Configuracao } from './shared/protocolo';

export function htmlWebview(webview: vscode.Webview, uri: vscode.Uri): string {
  const css = webview.asWebviewUri(vscode.Uri.joinPath(uri, 'media', 'orquestra.css'));
  const js = webview.asWebviewUri(vscode.Uri.joinPath(uri, 'dist', 'webview.js'));
  return montarHtml(webview.cspSource, String(css), String(js));
}
interface OpcoesProvedor extends OpcoesApi {
  comando?: string;
}
let encerrar: (() => Promise<void>) | undefined;
export async function activate(
  context: vscode.ExtensionContext,
): Promise<{ registrarProvedor: (p: Provedor) => vscode.Disposable }> {
  const raizes = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
    projeto = raizes[0] ?? null;
  const id = chaveSala(raizes),
    pasta = join(homedir(), '.orquestra', 'dados');
  const storage = new Armazenamento(
    join(pasta, 'orquestra.sqlite'),
    join(context.extensionPath, 'dist', 'sql-wasm.wasm'),
  );
  await storage.iniciar({ sala: id, projeto, titulo: projeto ? basename(projeto) : 'Sala avulsa' });
  const sala = new Sala(id, projeto, projeto ? basename(projeto) : 'Sala avulsa', storage);
  const cfg = () => vscode.workspace.getConfiguration('fagulha');
  const opcoes = (id: string): OpcoesProvedor => {
    const original = cfg().get<Record<string, OpcoesProvedor>>('provedores', {})[id] ?? {};
    return {
      modelo:
        cfg()
          .get<string>(`provedores.${id}.modelo`, original.modelo ?? '')
          .trim() || undefined,
      baseUrl:
        cfg()
          .get<string>(`provedores.${id}.baseUrl`, original.baseUrl ?? '')
          .trim() || undefined,
      comando:
        cfg()
          .get<string>(`provedores.${id}.comando`, original.comando ?? '')
          .trim() || undefined,
    };
  };
  // Assinaturas legadas dos adaptadores permanecem compatíveis, mas nunca abrem terminal.
  const terminal = async () => {
    throw new Error('Login por terminal não é permitido.');
  };
  const pedirChave = async () => undefined;
  const registrar = (p: Provedor) => {
    if (p.autenticacao?.tipoChave === 'compativel') {
      p.autenticacao.salvarBaseUrl = async (baseUrl) => {
        const provedores = cfg().get<Record<string, OpcoesProvedor>>('provedores', {});
        await cfg().update(
          'provedores',
          { ...provedores, [p.agente.id]: { ...provedores[p.agente.id], baseUrl } },
          projeto ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global,
        );
      };
    }
    sala.registrar(p);
  };
  for (const id of ['claude', 'codex', 'gemini'] as const)
    registrar(
      new ProvedorCli(
        id,
        terminal,
        opcoes(id).comando,
        join(pasta, 'cli', sala.id, id),
        context.secrets,
      ),
    );
  for (const id of [
    'ollama',
    'openai-api',
    'openai-compativel',
    'anthropic',
    'gemini-api',
  ] as ApiId[])
    registrar(new ProvedorApi(id, context.secrets, () => opcoes(id), pedirChave));
  // Manifests sao codigo executavel: carregar somente apos confianca no workspace.
  if (vscode.workspace.isTrusted)
    for (const m of await carregarManifestos(join(homedir(), '.orquestra', 'provedores')))
      registrar(
        criarProvedorManifesto(m, context.secrets, terminal, pedirChave, () => opcoes(m.id)),
      );
  await sala.iniciar();
  const voz = new VozLocal({
    segredos: context.secrets,
    carregar: async () =>
      (await storage.obter<import('./storage/global').ConfigGlobal>('globais', '', 'configuracao'))
        ?.voz,
    salvar: async (parcial) => (await storage.atualizarGlobal({ voz: parcial })).voz!,
    emitir: (evento) => {
      if (evento.tipo === 'estadoVoz') sala.voz = evento.voz;
      sala.emitir(evento);
    },
    agentes: () => sala.agentes,
    enviar: (texto) => sala.enviar(texto, []),
    auditar: async (resumo) => {
      await storage.gravar('auditoria', sala.id, randomUUID(), { resumo });
    },
  });
  sala.voz = await voz.inicializar();
  const abrir = async (url: string) => {
    if (!(await vscode.env.openExternal(vscode.Uri.parse(validarUrl(url).href))))
      throw new Error('Nao foi possivel abrir navegador.');
  };
  const views = new Set<vscode.Webview>();
  const integracoes = new Integracoes(
    {
      ler: async () =>
        (await storage.obter<RegistroIntegracao[]>('globais', '', 'integracoes')) ?? [],
      salvar: async (itens) => storage.gravar('globais', '', 'integracoes', itens),
    },
    context.secrets,
    sala.portao,
    (e) => {
      sala.integracoesConectadas = integracoes
        .listar()
        .filter((r) => r.estado === 'conectada' && r.ativa).length;
      for (const v of views) void v.postMessage(e);
      sala.estadoCompleto();
    },
  );
  await integracoes.iniciar();
  const executor = new ExecutorFerramentas(
    sala,
    raizes,
    abrir,
    join(pasta, 'sessoes'),
    integracoes,
  );
  const ponte = new PonteHttp(
    (id, nome, args, sinal) => executor.executar(id, nome, args, sinal),
    () => integracoes.ferramentas(),
  );
  await ponte.iniciar();
  const anexador = new Anexador(
    join(pasta, 'anexos'),
    join(context.extensionPath, 'dist', 'anexos-worker.js'),
    () => sala.config.limites,
  );
  sala.preparar = async (agente: Agente, sinal: AbortSignal) => {
    if (!vscode.workspace.isTrusted)
      throw new Error('Execucao de agentes requer workspace confiavel.');
    const p = sala.provedores.get(agente.id)!;
    // Autoriza envio do contexto ao provedor ANTES da chamada. Ollama permanece loopback.
    const externo = !(p instanceof ProvedorApi && p.id === 'ollama');
    await sala.portao.executar(
      {
        agente: agente.id,
        modo: 'leitura_escrita',
        categoria:
          agente.origem === 'manifesto' && agente.tipo === 'cli' ? 'comando' : 'rede_leitura',
        resumo: externo
          ? `Enviar contexto da sala a ${agente.nick}`
          : `Consultar ${agente.nick} local`,
        detalhe: p instanceof ProvedorApi ? p.endpoint : agente.nick,
        critica: agente.origem === 'manifesto' && agente.tipo === 'cli',
      },
      async () => {},
      sinal,
    );
    const capacidade = ponte.criar(agente.id, sinal);
    protegerSegredo(capacidade.token);
    const diretorio = join(pasta, 'sessoes', sala.chat.id, agente.id, randomUUID());
    const regras: string[] = [];
    try {
      if (projeto && agente.modo !== 'escrita')
        for (const nome of ['AGENTS.md', 'CLAUDE.md', join('orquestra', 'MEMORIA.md')]) {
          const caminho = join(projeto, nome);
          let existe = false;
          try {
            existe = (await stat(caminho)).isFile();
          } catch {}
          if (!existe) continue;
          const r = (await executor.executar(agente.id, 'arquivo_ler', { caminho }, sinal)) as {
            texto: string;
          };
          regras.push(`${nome}:\n${r.texto.slice(0, 16000)}`);
        }
      const enviados = new Set(sala.mensagens.flatMap((m) => (m.anexos ?? []).map((a) => a.id)));
      const imagens: { mime: string; base64: string }[] = [];
      if (agente.suportaImagem)
        for (const a of [...sala.anexos.values()]
          .filter((a) => enviados.has(a.meta.id) && a.meta.tipo === 'imagem' && a.arquivo)
          .slice(-4)) {
          const conteudo = await lerImagem(a.arquivo!, sala.config.limites.imagemMaxMB);
          const imagem = conteudo.conteudoMcp.find((c) => c.type === 'image');
          if (imagem?.type === 'image')
            imagens.push({ mime: imagem.mimeType, base64: imagem.data });
        }
      const mensagemAtual = [...sala.mensagens]
        .reverse()
        .find((m) => m.tipo === 'fala' && m.autor === sala.config.nick);
      const atuais = new Set((mensagemAtual?.anexos ?? []).map((a) => a.id));
      const caminhosImagens =
        agente.tipo === 'cli' && ['claude', 'codex', 'gemini'].includes(agente.id)
          ? await imagensNativas(
              [...sala.anexos.values()].filter((a) => atuais.has(a.meta.id)),
              sala.config.nivel,
              diretorio,
              sala.config.limites.imagemMaxMB,
            )
          : [];
      if (caminhosImagens.length)
        regras.push(
          `Imagens da mensagem atual: ${JSON.stringify(caminhosImagens)}. Leia esses arquivos como imagem; nao sao transcricoes. Se a ferramenta nativa nao estiver disponivel, use anexo_ler com o id listado no contexto.`,
        );
      return {
        regras,
        pedido: {
          ferramentas: [
            ...(JSON.parse(
              JSON.stringify(ferramentas),
            ) as import('@modelcontextprotocol/sdk/types.js').Tool[]),
            ...(await integracoes.ferramentas()),
          ],
          ponte: {
            url: capacidade.url,
            token: capacidade.token,
            servidor: join(context.extensionPath, 'dist', 'mcp-servidor.js'),
            diretorio,
          },
          imagens,
          caminhosImagens,
          ferramenta: (nome: string, args: Record<string, unknown>) =>
            executor.executar(agente.id, nome, args, sinal),
        },
        limpar: async () => {
          capacidade.revogar();
          await rm(diretorio, { recursive: true, force: true });
        },
      };
    } catch (e) {
      capacidade.revogar();
      await rm(diretorio, { recursive: true, force: true });
      throw e;
    }
  };
  const broadcast = sala.observar((e) => {
    for (const v of views) void v.postMessage(e);
    if (e.tipo === 'mensagem') voz.mensagem(e.mensagem);
    if (e.tipo === 'fase') {
      voz.fase(e.agente, e.fase);
      if (
        !vscode.window.state.focused &&
        ['concluido', 'aguardando_resposta', 'aguardando_aprovacao'].includes(e.fase.tipo)
      ) {
        const nick = sala.provedores.get(e.agente)?.agente.nick ?? 'Agente';
        void vscode.window.showInformationMessage(
          `${nick} ${e.fase.tipo === 'concluido' ? 'concluiu' : 'precisa da sua resposta'}`,
        );
      }
    }
    if (e.tipo === 'pergunta') voz.pergunta(e.pergunta);
  });
  let sincronizando = false;
  const sincronizacao = setInterval(() => {
    if (sincronizando) return;
    sincronizando = true;
    void sala
      .sincronizarGlobal()
      .then(() => voz.sincronizar())
      .catch(() => {})
      .finally(() => {
        sincronizando = false;
      });
  }, 1000);
  sincronizacao.unref();
  const aviso = (texto: string) =>
    sala.emitir({ tipo: 'aviso', nivel: 'erro', texto: mascarar(texto) });
  const prepararTroca = async () => {
    await voz.descartar();
    await voz.pararLeitura();
  };
  const exportarChat = async (id: string) => {
    const mensagens = await sala.mensagensChat(id);
    const uri = await vscode.window.showSaveDialog({
      defaultUri: projeto ? vscode.Uri.file(join(projeto, 'fagulha-conversa.md')) : undefined,
      filters: { Markdown: ['md'] },
    });
    if (!uri) return;
    const real = await caminhoReal(uri.fsPath, true);
    await writeFile(real, exportarMarkdown(mensagens), 'utf8');
  };
  const login = new GestorLogin({
    provedor: (id) => sala.provedores.get(id),
    emitir: (evento) => sala.emitir(evento),
    abrir: async (url) => {
      if (!(await vscode.env.openExternal(vscode.Uri.parse(url))))
        throw new Error('Não foi possível abrir o navegador.');
    },
    auditar: async (resumo) => {
      await storage.gravar('auditoria', sala.id, randomUUID(), { resumo });
    },
  });
  const configurarView = (webview: vscode.Webview, descartado: vscode.Event<void>) => {
    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(context.extensionUri, 'media'),
        vscode.Uri.joinPath(context.extensionUri, 'dist'),
      ],
    };
    views.add(webview);
    void vscode.commands.executeCommand('setContext', 'fagulha.painelAberto', true);
    webview.html = htmlWebview(webview, context.extensionUri);
    const listener = webview.onDidReceiveMessage(async (entrada) => {
      try {
        if (
          ['loginChave', 'leituraNuvemChave'].includes(entrada?.tipo) &&
          typeof entrada.chave === 'string'
        )
          protegerSegredo(entrada.chave);
        if (
          entrada?.tipo === 'conectarIntegracao' &&
          entrada.valores &&
          typeof entrada.valores === 'object'
        )
          for (const [k, v] of Object.entries(entrada.valores))
            if (/token|secret|password/i.test(k) && typeof v === 'string') protegerSegredo(v);
        const m = validarMensagem(entrada);
        if (m.tipo === 'pronto') {
          await sala.sincronizar();
          await webview.postMessage({ tipo: 'estado', estado: sala.estado() } satisfies DoHost);
          for (const progresso of login.progresso())
            await webview.postMessage({ tipo: 'login', progresso } satisfies DoHost);
          await webview.postMessage({
            tipo: 'integracoes',
            lista: integracoes.listar(),
          } satisfies DoHost);
          await webview.postMessage({ tipo: 'skills', lista: [] } satisfies DoHost);
          return;
        }
        if (
          !vscode.workspace.isTrusted &&
          (m.tipo === 'listarIntegracoes' || m.tipo === 'listarSkills')
        ) {
          await webview.postMessage(
            m.tipo === 'listarIntegracoes'
              ? { tipo: 'integracoes', lista: integracoes.listar() }
              : { tipo: 'skills', lista: [] },
          );
          return;
        }
        if (
          !vscode.workspace.isTrusted &&
          ![
            'parar',
            'responderPergunta',
            'cancelarPergunta',
            'leituraNuvemChave',
            'leituraNuvemRemover',
            'loginCancelar',
            'responderAprovacao',
            'carregarAnteriores',
            'vozParar',
            'vozDescartar',
            'vozCancelarInstalacao',
            'pararLeitura',
            'vozIniciar',
            'vozInstalar',
            'vozConfigurar',
            'leituraConfigurar',
            'lerMensagem',
            'novoChat',
            'listarChats',
            'abrirChat',
            'renomearChat',
            'fixarChat',
            'excluirChat',
            'exportarChat',
            'listarMemorias',
            'salvarMemoria',
            'excluirMemoria',
            'exportarConversa',
          ].includes(m.tipo)
        )
          throw new Error(
            'Conceda confianca ao workspace antes de usar agentes ou importar arquivos.',
          );
        if (
          await mensagemIntegracao(integracoes, m, (e) => {
            for (const v of views) void v.postMessage(e);
          })
        )
          return;
        switch (m.tipo) {
          case 'responderPergunta':
            sala.perguntas.responder(m.id, m.respostas);
            break;
          case 'cancelarPergunta':
            sala.perguntas.cancelar(m.id);
            break;
          case 'leituraNuvemChave':
            await voz.chaveNuvem(m.provedor, m.chave);
            break;
          case 'leituraNuvemRemover':
            await voz.removerChaveNuvem();
            break;
          case 'novoChat':
            await prepararTroca();
            await sala.novoChat();
            break;
          case 'listarChats':
            await sala.listarChats(m.busca);
            break;
          case 'abrirChat':
            await prepararTroca();
            await sala.abrirChat(m.id);
            break;
          case 'renomearChat':
            await sala.renomearChat(m.id, m.titulo);
            break;
          case 'fixarChat':
            await sala.fixarChat(m.id, m.fixado);
            break;
          case 'excluirChat': {
            if (m.id === sala.chat.id) await prepararTroca();
            const arquivos = await sala.excluirChat(m.id);
            await anexador.excluirSemReferencia(arquivos, async (arquivo) =>
              (await storage.listar<{ arquivo?: string }>('anexos')).some(
                (a) => a.arquivo === arquivo,
              ),
            );
            break;
          }
          case 'exportarChat':
            await exportarChat(m.id);
            break;
          case 'listarMemorias':
            await sala.atualizarMemorias();
            break;
          case 'salvarMemoria':
            await sala.salvarMemoria(m);
            break;
          case 'excluirMemoria':
            await sala.excluirMemoria(m.id);
            break;
          case 'enviar':
            sala.enviar(m.texto, m.anexos);
            break;
          case 'parar':
            sala.parar();
            break;
          case 'carregarAnteriores': {
            const i = sala.mensagens.findIndex((x) => x.id === m.antesDe);
            const antes = i < 0 ? 0 : i;
            await webview.postMessage({
              tipo: 'anteriores',
              mensagens: sala.mensagens.slice(Math.max(0, antes - 200), antes),
              fim: antes <= 200,
            } satisfies DoHost);
            break;
          }
          case 'anexarArquivos': {
            const uris = await vscode.window.showOpenDialog({
              canSelectMany: true,
              canSelectFolders: false,
              title: 'Orquestrador Fagulha: anexar arquivos',
            });
            for (const uri of uris ?? [])
              await sala.adicionarAnexo(await anexador.arquivo(uri.fsPath));
            break;
          }
          case 'anexarDados':
            await sala.adicionarAnexo(await anexador.dados(m.nome, m.base64));
            break;
          case 'anexarCaminhos': {
            for (const valor of m.uris) {
              const uri = vscode.Uri.parse(valor);
              if (uri.scheme !== 'file')
                throw new Error(
                  'Arraste arquivos locais (file://). URIs remotas nao sao aceitas nesta F1.',
                );
              await sala.adicionarAnexo(await anexador.arquivo(uri.fsPath));
            }
            break;
          }
          case 'removerAnexo':
            sala.removerAnexo(m.id);
            break;
          case 'importarContexto': {
            const candidatos = await descobrirContextos();
            const chats = (await sala.chats.listar()).filter((c) => c.id !== sala.chat.id);
            const itens = [
              ...candidatos.map((c) => ({ label: c.titulo, description: c.origem, c })),
              ...chats.map((c) => ({
                label: c.titulo,
                description: c.projetoNome ?? 'Sem projeto',
                s: c.id,
              })),
            ];
            const selecionado = await vscode.window.showQuickPick(itens, {
              title: 'Importar contexto local',
              matchOnDescription: true,
            });
            if (selecionado && 'c' in selecionado)
              await sala.adicionarContexto(await importarContexto(selecionado.c));
            if (selecionado && 's' in selecionado) {
              const texto = (await sala.mensagensChat(selecionado.s))
                .map((m) => `${m.autor}: ${m.texto}`)
                .join('\n')
                .slice(-12000);
              await sala.adicionarContexto({
                meta: {
                  id: randomUUID(),
                  origem: 'sala-orquestra',
                  titulo: selecionado.s,
                  caracteres: texto.length,
                },
                texto,
              });
            }
            break;
          }
          case 'removerContexto':
            await sala.removerContexto(m.id);
            break;
          case 'responderAprovacao':
            await sala.responderAprovacao(m.id, m.decisao);
            break;
          case 'agenteHabilitar':
            await sala.atualizarAgente(m.id, { habilitado: m.habilitado });
            break;
          case 'agenteModo':
            await sala.atualizarAgente(m.id, { modo: m.modo });
            break;
          case 'agentePapel':
            await sala.atualizarAgente(m.id, { papel: m.papel });
            break;
          case 'agenteNovaSessao':
            await sala.novaSessao(m.id);
            break;
          case 'agenteConfigurar':
            if (!sala.provedores.has(m.id)) throw new Error('Agente desconhecido.');
            await vscode.commands.executeCommand(
              'workbench.action.openSettings',
              `fagulha.provedores.${m.id}`,
            );
            break;
          case 'loginIniciar':
            await login.iniciar(m.id, m.metodo, m.variante);
            break;
          case 'loginChave':
            await login.chave(m.id, m.chave, m.baseUrl);
            break;
          case 'loginCancelar':
            login.cancelar(m.id);
            break;
          case 'logout': {
            await sala.novaSessao(m.id);
            await login.logout(m.id);
            break;
          }
          case 'abrirLinkLogin':
            await login.abrir(m.url);
            break;
          case 'instalarAgente': {
            const escolha = await vscode.window.showQuickPick(
              ['Importar manifesto local', 'Procurar extensao no Marketplace'],
              { title: 'Adicionar agente' },
            );
            if (escolha === 'Procurar extensao no Marketplace') {
              await vscode.commands.executeCommand(
                'workbench.extensions.search',
                'fagulha provider',
              );
              break;
            }
            if (escolha !== 'Importar manifesto local') break;
            const arquivos = await vscode.window.showOpenDialog({
              canSelectMany: false,
              filters: { Manifesto: ['json'] },
            });
            if (!arquivos?.[0]) break;
            const m = await lerManifesto(await caminhoReal(arquivos[0].fsPath));
            if (sala.provedores.has(m.id)) throw new Error('ID de agente ja registrado.');
            const ok = await vscode.window.showWarningMessage(
              `Manifesto ${m.nick} pode executar codigo local. Origem: ${arquivos[0].fsPath}`,
              { modal: true },
              'Adicionar',
            );
            if (ok !== 'Adicionar') break;
            const prov = criarProvedorManifesto(m, context.secrets, terminal, pedirChave, () =>
              opcoes(m.id),
            );
            const detectado = await prov.detectar();
            prov.agente.instalado = detectado.instalado;
            registrar(prov);
            const pastaManifesto = join(homedir(), '.orquestra', 'provedores', m.id);
            await mkdir(pastaManifesto, { recursive: true });
            await writeFile(
              join(pastaManifesto, 'orquestra-provedor.json'),
              JSON.stringify(m, null, 2),
              { mode: 0o600 },
            );
            sala.estadoCompleto();
            break;
          }
          case 'configurar':
            await sala.configurar(m.parcial);
            break;
          case 'definirNivel':
            await sala.configurar({ nivel: m.nivel }, m.confirmacao);
            break;
          case 'concluirAssistente':
            await sala.concluirAssistente();
            break;
          case 'vozIniciar':
            await voz.iniciar();
            break;
          case 'vozParar':
            await voz.parar();
            break;
          case 'vozDescartar':
            await voz.descartar();
            break;
          case 'vozInstalar':
            await voz.instalar(m.componentes);
            break;
          case 'vozCancelarInstalacao':
            voz.cancelarInstalacao();
            break;
          case 'vozConfigurar': {
            const { tipo, ...parcial } = m;
            await voz.configurar(parcial);
            break;
          }
          case 'leituraConfigurar': {
            const { tipo, ...parcial } = m;
            await voz.configurarLeitura(parcial);
            break;
          }
          case 'lerMensagem': {
            const mensagem = sala.mensagens.find((x) => x.id === m.id);
            if (!mensagem) throw new Error('Mensagem não encontrada.');
            await voz.pararLeitura();
            await voz.ler(mensagem);
            break;
          }
          case 'pararLeitura':
            await voz.pararLeitura();
            break;
          case 'abrirLink':
            await sala.portao.executar(
              {
                agente: 'usuario',
                modo: 'leitura_escrita',
                categoria: 'navegador',
                resumo: 'Abrir link',
                detalhe: validarUrl(m.url).href,
              },
              () => abrir(m.url),
            );
            break;
          case 'exportarConversa': {
            await exportarChat(sala.chat.id);
            break;
          }
        }
      } catch (e) {
        aviso((e as Error).message);
      }
    });
    const disposal = descartado(() => {
      views.delete(webview);
      void vscode.commands.executeCommand('setContext', 'fagulha.painelAberto', views.size > 0);
      listener.dispose();
      disposal.dispose();
    });
    context.subscriptions.push(listener, disposal);
  };
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      'fagulha.sala',
      {
        resolveWebviewView(view) {
          configurarView(view.webview, view.onDidDispose);
        },
      },
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('fagulha.vozAlternar', async () => {
      if (!views.size) return;
      try {
        if (voz.estado.gravando) await voz.parar();
        else await voz.iniciar();
      } catch (e) {
        aviso((e as Error).message);
      }
    }),
    vscode.commands.registerCommand('fagulha.abrirNoEditor', () => {
      const panel = vscode.window.createWebviewPanel(
        'fagulha.sala',
        'Orquestrador Fagulha',
        vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true },
      );
      panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'logo.png');
      configurarView(panel.webview, panel.onDidDispose);
    }),
  );
  encerrar = async () => {
    clearInterval(sincronizacao);
    await voz.finalizar();
    await login.finalizar();
    sala.parar();
    broadcast();
    await sala.esperar();
    await ponte.finalizar();
    await integracoes.finalizar();
    await storage.finalizar();
  };
  context.subscriptions.push({
    dispose() {
      void encerrar?.();
    },
  });
  return {
    registrarProvedor(p) {
      sala.registrar(p);
      void p
        .detectar()
        .then(async (d) => {
          p.agente.instalado = d.instalado;
          p.agente.versao = d.versao;
          p.agente.login = await p.estadoLogin();
          sala.estadoCompleto();
        })
        .catch((e) => aviso((e as Error).message));
      return new vscode.Disposable(() => {
        void sala.desregistrar(p.agente.id);
      });
    },
  };
}
export async function deactivate(): Promise<void> {
  await encerrar?.();
  encerrar = undefined;
}
