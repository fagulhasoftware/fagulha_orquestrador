import { randomUUID, createHash } from 'node:crypto';
import type {
  Agente,
  Configuracao,
  DoHost,
  EstadoSala,
  Mensagem,
  ModoAgente,
  Memoria,
  ResumoChat,
  PedidoAprovacao,
  DecisaoAprovacao,
} from '../shared/protocolo';
import { VERSAO_PROTOCOLO, CONFIRMACAO_NIVEL_TOTAL } from '../shared/protocolo';
import type { Provedor, PedidoExecucao } from '../providers/tipos';
import { Armazenamento } from '../storage/sqlite';
import { configuracaoPadrao, limitar } from './configuracao';
import { mascarar } from './seguranca';
import { montarContexto } from './contexto';
import type { AnexoArmazenado } from '../attachments/pipeline';
import type { ContextoCompleto } from '../context-import/importador';
import { Portao } from '../permissions/portao';
import { estadoInicialVoz } from '../voice/configuracao';
import { Chats } from './chats';
import { Memorias, contextoMemorias, memoriasDoProjeto } from './memoria';
import { resumoChat, mesmoProjeto, type ChatPersistido } from '../storage/chats';
export function chaveSala(raizes: string[]): string {
  const normalizadas = raizes
    .map((p) => (process.platform === 'win32' ? p.toLowerCase() : p))
    .sort();
  return normalizadas.length
    ? createHash('sha256').update(JSON.stringify(normalizadas)).digest('hex').slice(0, 24)
    : 'avulsa';
}
export function mencoes(texto: string, agentes: Agente[]): string[] {
  const achados = new Set<string>();
  const habilitados = agentes.filter((a) => a.habilitado && a.instalado);
  for (const m of texto.matchAll(/(?:^|[^\p{L}\p{N}_@])@([\p{L}\p{N}_:-]+)/gu)) {
    const nick = m[1].toLowerCase();
    if (nick === 'todos') {
      for (const a of habilitados) achados.add(a.id);
      continue;
    }
    for (const a of habilitados)
      if ([a.id, a.nick, ...a.apelidos].some((n) => n.toLowerCase() === nick)) achados.add(a.id);
  }
  return [...achados];
}
export function passagem(
  origem: string,
  texto: string,
  saltos: number,
  limite: number,
  agentes: Agente[],
): string[] {
  return saltos >= limite ? [] : mencoes(texto, agentes).filter((id) => id !== origem);
}
interface Sessao {
  id: string;
  visto: number;
  modo: ModoAgente;
  nivel: Configuracao['nivel'];
  projeto?: string | null;
}
interface Persistida {
  configuracao: Configuracao;
  primeiraExecucao: boolean;
  anexosPendentes?: string[];
  ultimo_chat?: string;
}
export class Sala {
  readonly provedores = new Map<string, Provedor>();
  readonly mensagens: Mensagem[] = [];
  readonly anexos = new Map<string, AnexoArmazenado>();
  readonly contextos = new Map<string, ContextoCompleto>();
  readonly anexosPendentes = new Set<string>();
  readonly chats: Chats;
  readonly memorias: Memorias;
  chat!: ChatPersistido;
  private memoriasLista: Memoria[] = [];
  private trocando = false;
  private trocas: Promise<unknown> = Promise.resolve();
  private aprovacoesOutras: PedidoAprovacao[] = [];
  private consultasAprovacao = new Map<string, NodeJS.Timeout>();
  config = configuracaoPadrao();
  primeiraExecucao = true;
  voz: EstadoSala['voz'] = estadoInicialVoz();
  private sessoes = new Map<string, Sessao>();
  private fila: { id: string; saltos: number }[] = [];
  private atual?: { id: string; controle: AbortController };
  private ouvintes = new Set<(e: DoHost) => void>();
  private persistencias: Promise<unknown>[] = [];
  private tarefa?: Promise<void>;
  readonly portao: Portao;
  preparar?: (
    agente: Agente,
    sinal: AbortSignal,
  ) => Promise<{ pedido: Partial<PedidoExecucao>; regras: string[]; limpar: () => Promise<void> }>;
  constructor(
    readonly id: string,
    readonly projeto: string | null,
    readonly titulo: string,
    readonly storage: Armazenamento,
  ) {
    this.chats = new Chats(storage, id, projeto);
    this.memorias = new Memorias(storage, projeto);
    this.portao = new Portao(
      () => this.config,
      (e) => this.emitir(e),
      async (r) => {
        const id = (r as { id: string }).id;
        await storage.gravar('auditoria', this.id, id, r);
      },
    );
  }
  get agentes(): Agente[] {
    return [...this.provedores.values()].map((p) => p.agente);
  }
  registrar(provedor: Provedor): void {
    if (this.provedores.has(provedor.agente.id)) throw new Error('ID de provedor ja registrado.');
    if (!/^[a-z0-9][a-z0-9_:-]{0,79}$/i.test(provedor.agente.id))
      throw new Error('ID de provedor invalido.');
    this.provedores.set(provedor.agente.id, provedor);
  }
  async desregistrar(id: string): Promise<void> {
    if (this.atual?.id === id) {
      this.parar();
      await this.esperar();
    }
    this.fila = this.fila.filter((f) => f.id !== id);
    this.portao.limparSessao(id);
    this.provedores.delete(id);
    this.estadoCompleto();
  }
  observar(fn: (e: DoHost) => void): () => void {
    this.ouvintes.add(fn);
    return () => this.ouvintes.delete(fn);
  }
  emitir(evento: DoHost): void {
    if (evento.tipo === 'mensagem') {
      const m = evento.mensagem;
      m.sala = this.id;
      m.texto = mascarar(m.texto);
      const indice = this.mensagens.findIndex((x) => x.id === m.id);
      if (indice < 0) this.mensagens.push(m);
      else this.mensagens[indice] = m;
      const chatId = this.chat.id;
      this.persistir(
        this.storage
          .gravarMensagem(chatId, m, m.tipo === 'fala' && m.autor === this.config.nick)
          .then((chat) => {
            if (this.chat.id !== chatId) return;
            const tituloMudou = this.chat.titulo !== chat.titulo;
            this.chat = chat;
            this.emitir({ tipo: 'chat', chat: resumoChat(chat, this.projeto) });
            if (tituloMudou) this.persistir(this.listarChats());
          }),
      );
    }
    if (evento.tipo === 'aprovacao') {
      this.persistir(
        this.storage.gravarDoChat('aprovacoes', this.chat.id, evento.pedido.id, {
          ...evento.pedido,
          donoPid: process.pid,
        }),
      );
      const chat = this.chat.id;
      let consultando = false;
      const timer = setInterval(() => {
        if (consultando) return;
        consultando = true;
        void this.storage
          .obter<{ decisao?: DecisaoAprovacao | 'expirada' }>('aprovacoes', chat, evento.pedido.id)
          .then((p) => {
            if (!p || p.decisao === 'expirada') this.portao.responder(evento.pedido.id, 'negar');
            else if (p?.decisao) this.portao.responder(evento.pedido.id, p.decisao);
          })
          .catch(() => {})
          .finally(() => {
            consultando = false;
          });
      }, 250);
      timer.unref();
      this.consultasAprovacao.set(evento.pedido.id, timer);
    }
    if (evento.tipo === 'aprovacaoResolvida') {
      clearInterval(this.consultasAprovacao.get(evento.id));
      this.consultasAprovacao.delete(evento.id);
      this.persistir(
        this.storage.gravarDoChat('aprovacoes', this.chat.id, evento.id, {
          id: evento.id,
          decisao: evento.decisao,
        }),
      );
    }
    for (const fn of this.ouvintes)
      try {
        fn(evento);
      } catch {
        /* webview descartado */
      }
  }
  private persistir(p: Promise<unknown>): void {
    this.persistencias.push(
      p.catch(() => {
        for (const fn of this.ouvintes)
          fn({
            tipo: 'aviso',
            nivel: 'erro',
            texto: 'Falha ao persistir dados locais. Verifique espaco/permissoes.',
          });
      }),
    );
    if (this.persistencias.length > 1000) this.persistencias = this.persistencias.slice(-500);
  }
  async iniciar(): Promise<void> {
    const sala = await this.storage.obter<Persistida>('salas', this.id, this.id);
    if (sala) {
      this.config = {
        ...configuracaoPadrao(),
        ...sala.configuracao,
        limites: limitar(sala.configuracao.limites),
      };
      this.primeiraExecucao = sala.primeiraExecucao;
      if (this.config.nivel === 'total' && !this.config.nivelConfirmadoEm)
        this.config.nivel = 'manual';
    }
    for (const p of this.provedores.values()) {
      const salvo = await this.storage.obter<Agente>('provedores', this.id, p.agente.id);
      if (salvo)
        Object.assign(p.agente, {
          habilitado: salvo.habilitado,
          papel: salvo.papel,
          modo: salvo.modo,
        });
      const detectado = await p.detectar();
      Object.assign(p.agente, {
        instalado: detectado.instalado,
        versao: detectado.versao,
        login: await p.estadoLogin(),
        temSessao: this.sessoes.has(p.agente.id),
      });
      if (!salvo && p.agente.tipo === 'cli') p.agente.habilitado = detectado.instalado;
      p.agente.estado = p.agente.habilitado ? 'livre' : 'desabilitado';
    }
    this.chat = await this.chats.inicial(this.config.nick);
    await this.carregarChat();
    await this.atualizarMemorias(false);
    await this.salvar();
  }
  private async carregarChat(): Promise<void> {
    this.chat = await this.chats.obter(this.chat.id);
    this.mensagens.length = 0;
    for (const mensagem of await this.storage.listar<Mensagem>('mensagens', this.chat.id))
      this.mensagens.push(mensagem);
    this.anexos.clear();
    this.contextos.clear();
    this.anexosPendentes.clear();
    this.sessoes.clear();
    for (const a of await this.storage.listar<AnexoArmazenado>('anexos', this.chat.id))
      this.anexos.set(a.meta.id, a);
    for (const id of this.chat.anexosPendentes)
      if (this.anexos.has(id)) this.anexosPendentes.add(id);
    for (const c of await this.storage.listar<ContextoCompleto>('contextos', this.chat.id))
      this.contextos.set(c.meta.id, c);
    for (const p of this.provedores.values()) {
      const sessao = await this.storage.obter<Sessao>(
        'sessoes_provedor',
        this.chat.id,
        `${p.agente.id}:${p.agente.modo}`,
      );
      if (
        sessao &&
        sessao.modo === p.agente.modo &&
        sessao.nivel === this.config.nivel &&
        mesmoProjeto(
          sessao.projeto === undefined ? this.chat.projeto : sessao.projeto,
          this.projeto,
        )
      )
        this.sessoes.set(p.agente.id, sessao);
      p.agente.temSessao = this.sessoes.has(p.agente.id);
    }
    // Um pedido de um processo encerrado nao pode executar um efeito ao reabrir a janela.
    this.aprovacoesOutras = [];
    for (const pedido of await this.storage.listar<
      PedidoAprovacao & { decisao?: string; donoPid?: number }
    >('aprovacoes', this.chat.id)) {
      if (pedido.decisao || this.portao.pendentes.has(pedido.id)) continue;
      let vivo = false;
      if (pedido.donoPid) {
        try {
          process.kill(pedido.donoPid, 0);
          vivo = true;
        } catch (e) {
          vivo = (e as NodeJS.ErrnoException).code === 'EPERM';
        }
      }
      if (!vivo || !pedido.expiraEm || Date.parse(pedido.expiraEm) <= Date.now())
        await this.storage.resolverAprovacao(this.chat.id, pedido.id, 'expirada');
      else {
        const { decisao, donoPid, ...publico } = pedido;
        this.aprovacoesOutras.push(publico);
      }
    }
  }
  async responderAprovacao(id: string, decisao: DecisaoAprovacao): Promise<void> {
    if (this.portao.pendentes.has(id)) {
      this.portao.responder(id, decisao);
      return;
    }
    if (!this.aprovacoesOutras.some((p) => p.id === id))
      throw new Error('Aprovacao nao encontrada neste chat.');
    const resolvida = await this.storage.resolverAprovacao(this.chat.id, id, decisao);
    this.aprovacoesOutras = this.aprovacoesOutras.filter((p) => p.id !== id);
    if (resolvida)
      for (const fn of this.ouvintes) {
        try {
          fn({ tipo: 'aprovacaoResolvida', id, decisao });
        } catch {
          /* webview descartado */
        }
      }
  }
  async sincronizar(): Promise<void> {
    await Promise.all(this.persistencias);
    if (this.atual || this.trocando) return;
    try {
      await this.carregarChat();
    } catch {
      this.chat = await this.chats.inicial(this.config.nick);
      await this.carregarChat();
      await this.salvar();
    }
    await this.atualizarMemorias(false);
  }
  private trocar(fn: () => Promise<ChatPersistido>): Promise<void> {
    const tarefa = this.trocas.then(async () => {
      this.trocando = true;
      try {
        this.parar();
        await this.esperar();
        this.chat = await fn();
        await this.carregarChat();
        await this.atualizarMemorias(false);
        await this.salvar();
        this.estadoCompleto();
        this.emitir({ tipo: 'chat', chat: resumoChat(this.chat, this.projeto) });
        await this.listarChats();
      } finally {
        this.trocando = false;
      }
    });
    this.trocas = tarefa.catch(() => {});
    return tarefa;
  }
  novoChat(): Promise<void> {
    return this.trocar(() => this.chats.criar(this.config.nick));
  }
  abrirChat(id: string): Promise<void> {
    return this.trocar(() => this.chats.obter(id));
  }
  async listarChats(busca?: string): Promise<ResumoChat[]> {
    const lista = await this.chats.listar(busca);
    this.emitir({ tipo: 'chats', lista, ...(busca !== undefined ? { busca } : {}) });
    return lista;
  }
  async renomearChat(id: string, titulo: string): Promise<void> {
    const chat = await this.chats.renomear(id, titulo);
    if (id === this.chat.id) {
      this.chat = chat;
      this.emitir({ tipo: 'chat', chat: resumoChat(chat, this.projeto) });
    }
    await this.listarChats();
  }
  async fixarChat(id: string, fixado: boolean): Promise<void> {
    const chat = await this.chats.fixar(id, fixado);
    if (id === this.chat.id) {
      this.chat = chat;
      this.emitir({ tipo: 'chat', chat: resumoChat(chat, this.projeto) });
    }
    await this.listarChats();
  }
  async excluirChat(id: string): Promise<string[]> {
    let arquivos: string[] = [];
    if (id === this.chat.id)
      await this.trocar(async () => {
        arquivos = await this.storage.excluirChat(id);
        return this.chats.inicial(this.config.nick);
      });
    else {
      arquivos = await this.storage.excluirChat(id);
      await this.listarChats();
    }
    return arquivos;
  }
  async mensagensChat(id: string): Promise<Mensagem[]> {
    await Promise.all(this.persistencias);
    await this.chats.obter(id);
    return this.storage.listar('mensagens', id);
  }
  async atualizarMemorias(emitir = true): Promise<void> {
    this.memoriasLista = await this.memorias.listar();
    if (emitir) {
      this.emitir({ tipo: 'memorias', lista: this.memoriasLista });
      this.estadoCompleto();
    }
  }
  async salvarMemoria(
    entrada: { id?: string; escopo: Memoria['escopo']; texto: string; ativa?: boolean },
    agente?: string,
  ): Promise<Memoria> {
    const memoria = await this.memorias.salvar(entrada, agente);
    await this.atualizarMemorias();
    return memoria;
  }
  async excluirMemoria(id: string): Promise<void> {
    await this.memorias.excluir(id);
    await this.atualizarMemorias();
  }
  estado(): EstadoSala {
    return {
      versaoProtocolo: VERSAO_PROTOCOLO,
      sala: { id: this.id, projeto: this.projeto, titulo: this.titulo },
      chat: resumoChat(this.chat, this.projeto),
      memoriasAtivas: memoriasDoProjeto(this.memoriasLista, this.projeto).length,
      configuracao: this.config,
      agentes: this.agentes,
      mensagens: this.mensagens.slice(-200),
      anexosPendentes: [...this.anexosPendentes].map((id) => this.anexos.get(id)!.meta),
      contextos: [...this.contextos.values()].map((c) => c.meta),
      aprovacoes: [...this.portao.pendentes.values(), ...this.aprovacoesOutras],
      primeiraExecucao: this.primeiraExecucao,
      voz: this.voz,
    };
  }
  estadoCompleto(): void {
    this.emitir({ tipo: 'estado', estado: this.estado() });
  }
  mensagem(
    autor: string,
    texto: string,
    tipo: Mensagem['tipo'] = 'fala',
    anexos?: string[],
  ): Mensagem {
    const referencias = anexos?.map((id) => {
      const meta = this.anexos.get(id)?.meta;
      if (!meta) throw new Error('Anexo desconhecido.');
      return { id, nome: meta.nome, tipo: meta.tipo };
    });
    const mensagem: Mensagem = {
      id: randomUUID(),
      sala: this.id,
      quando: new Date().toISOString(),
      autor,
      tipo,
      texto: mascarar(texto),
      ...(referencias?.length ? { anexos: referencias } : {}),
    };
    this.emitir({ tipo: 'mensagem', mensagem });
    return mensagem;
  }
  enviar(texto: string, anexos: string[]): void {
    if (this.trocando) throw new Error('Aguarde a troca de chat terminar.');
    if (texto.trim() === '/parar') {
      this.parar();
      return;
    }
    if (!texto.trim() && !anexos.length) return;
    if (
      anexos.some(
        (id) =>
          !this.anexosPendentes.has(id) || this.anexos.get(id)?.meta.tratamento === 'recusado',
      )
    )
      throw new Error('Anexo inexistente, recusado ou ja enviado.');
    this.mensagem(this.config.nick, texto, 'fala', anexos);
    for (const id of anexos) {
      this.anexosPendentes.delete(id);
      this.emitir({ tipo: 'anexoRemovido', id });
    }
    this.persistir(this.storage.pendentesChat(this.chat.id, [], anexos));
    for (const id of mencoes(texto, this.agentes)) this.acionar(id, 0);
  }
  acionar(id: string, saltos = 0): void {
    if (this.trocando) return;
    const a = this.provedores.get(id)?.agente;
    if (!a?.habilitado || !a.instalado || this.fila.some((f) => f.id === id)) return;
    this.fila.push({ id, saltos });
    if (this.atual?.id !== id) {
      a.estado = 'na_fila';
      this.emitir({ tipo: 'agente', agente: a });
    }
    if (!this.tarefa) {
      this.tarefa = this.proximo().finally(() => {
        this.tarefa = undefined;
        if (this.fila.length) this.acionarProximo();
      });
    }
  }
  private acionarProximo(): void {
    if (!this.tarefa)
      this.tarefa = this.proximo().finally(() => {
        this.tarefa = undefined;
        if (this.fila.length) this.acionarProximo();
      });
  }
  private async proximo(): Promise<void> {
    while (this.fila.length) {
      const entrada = this.fila.shift()!,
        p = this.provedores.get(entrada.id);
      if (!p?.agente.habilitado) continue;
      const a = p.agente,
        controle = new AbortController();
      this.atual = { id: a.id, controle };
      a.estado = 'trabalhando';
      this.emitir({ tipo: 'agente', agente: a });
      const timer = setTimeout(() => controle.abort(), this.config.timeoutMinutos * 60_000);
      const falas: string[] = [];
      let parcial: Mensagem | undefined,
        sessao = this.sessoes.get(a.id),
        falhou = false;
      let visto = this.mensagens.length;
      let preparada: Awaited<ReturnType<NonNullable<Sala['preparar']>>> | undefined;
      try {
        await Promise.all(this.persistencias);
        await this.carregarChat();
        sessao = this.sessoes.get(a.id);
        await this.atualizarMemorias(false);
        preparada = await this.preparar?.(a, controle.signal);
        const enviados = new Set(this.mensagens.flatMap((m) => (m.anexos ?? []).map((a) => a.id)));
        const anexos = [...this.anexos.values()].filter(
          (x) => enviados.has(x.meta.id) && x.meta.tratamento !== 'recusado',
        );
        const prompt = montarContexto({
          agente: a,
          agentes: this.agentes,
          config: this.config,
          projeto: this.projeto,
          historico: this.mensagens,
          visto: sessao?.visto,
          sessao: sessao?.id,
          regras: preparada?.regras ?? [],
          anexos: anexos
            .slice(-20)
            .map((x) => `${x.meta.nome}: ${x.meta.aviso ?? ''}\n${x.texto.slice(0, 12000)}`),
          contextos: [...this.contextos.values()].map((c) => `${c.meta.titulo}:\n${c.texto}`),
          memoria: contextoMemorias(this.memoriasLista, this.projeto),
        });
        visto = this.mensagens.length;
        const pedido: PedidoExecucao = {
          prompt,
          projeto: this.projeto ?? process.cwd(),
          modo: a.modo,
          nivel: this.config.nivel,
          sessao: sessao?.id,
          ponte: { url: '', token: '', servidor: '', diretorio: '' },
          ...preparada?.pedido,
        };
        await p.executar(
          pedido,
          {
            sessao: (id) => {
              if (controle.signal.aborted) return;
              sessao = {
                id,
                visto: sessao?.visto ?? 0,
                modo: a.modo,
                nivel: this.config.nivel,
                projeto: this.projeto,
              };
              this.sessoes.set(a.id, sessao);
              a.temSessao = true;
              this.emitir({ tipo: 'agente', agente: a });
            },
            fala: (txt) => {
              if (txt.trim()) {
                falas.push(txt);
                this.mensagem(a.nick, txt);
              }
            },
            parcial: (txt) => {
              if (!parcial)
                parcial = {
                  id: randomUUID(),
                  sala: this.id,
                  quando: new Date().toISOString(),
                  autor: a.nick,
                  tipo: 'fala',
                  texto: '',
                  parcial: true,
                };
              parcial = { ...parcial, texto: parcial.texto + txt };
              this.emitir({ tipo: 'mensagem', mensagem: parcial });
            },
            acao: (txt) => {
              this.mensagem(a.nick, txt, 'acao');
            },
            sistema: (txt) => {
              this.mensagem('sistema', txt, 'sistema');
            },
            erro: (txt) => {
              falhou = true;
              this.mensagem(a.nick, txt, 'erro');
            },
          },
          controle.signal,
        );
      } catch (e) {
        falhou = true;
        this.mensagem(
          a.nick,
          controle.signal.aborted ? 'Interrompido.' : String((e as Error).message),
          'erro',
        );
      } finally {
        clearTimeout(timer);
        try {
          await preparada?.limpar();
        } catch {
          this.mensagem('sistema', 'Falha ao limpar arquivos temporarios da sessao.', 'erro');
        }
        if (parcial) {
          parcial = { ...parcial, parcial: false };
          this.emitir({ tipo: 'mensagem', mensagem: parcial });
          falas.push(parcial.texto);
        }
        if (sessao && this.sessoes.has(a.id)) {
          sessao.visto = visto;
          this.persistir(
            this.storage.gravarDoChat(
              'sessoes_provedor',
              this.chat.id,
              `${a.id}:${a.modo}`,
              sessao,
            ),
          );
        }
        a.estado = a.habilitado
          ? falhou && !controle.signal.aborted
            ? 'erro'
            : 'livre'
          : 'desabilitado';
        this.atual = undefined;
        this.emitir({ tipo: 'agente', agente: a });
      }
      if (!controle.signal.aborted && !falhou) {
        const publicadas = this.mensagens
          .slice(visto)
          .filter((m) => m.autor === a.nick && m.tipo === 'fala')
          .map((m) => m.texto)
          .join('\n');
        for (const alvo of passagem(
          a.id,
          publicadas,
          entrada.saltos,
          this.config.passagensAutomaticas,
          this.agentes,
        ))
          this.acionar(alvo, entrada.saltos + 1);
        if (
          entrada.saltos >= this.config.passagensAutomaticas &&
          mencoes(publicadas, this.agentes).some((id) => id !== a.id)
        )
          this.mensagem(
            'sistema',
            'Limite de passagens automaticas atingido. A palavra volta ao dono.',
            'sistema',
          );
      }
    }
  }
  parar(): void {
    this.fila = [];
    this.atual?.controle.abort();
    this.portao.limparSessao();
    for (const a of this.agentes)
      if (a.estado === 'na_fila') {
        a.estado = a.habilitado ? 'livre' : 'desabilitado';
        this.emitir({ tipo: 'agente', agente: a });
      }
  }
  async esperar(): Promise<void> {
    await this.tarefa;
    await Promise.all(this.persistencias);
  }
  async novaSessao(id: string): Promise<void> {
    if (this.atual?.id === id) {
      this.parar();
      await this.esperar();
    }
    this.portao.limparSessao(id);
    this.sessoes.delete(id);
    const a = this.provedores.get(id)?.agente;
    if (a) {
      a.temSessao = false;
      this.emitir({ tipo: 'agente', agente: a });
    }
    if (this.chat && a)
      await this.storage.remover('sessoes_provedor', this.chat.id, `${id}:${a.modo}`);
  }
  async atualizarAgente(
    id: string,
    parcial: Partial<Pick<Agente, 'habilitado' | 'modo' | 'papel'>>,
  ): Promise<void> {
    const a = this.provedores.get(id)?.agente;
    if (!a) throw new Error('Agente desconhecido.');
    if (
      a.estado === 'trabalhando' &&
      ((parcial.modo && parcial.modo !== a.modo) || parcial.habilitado === false)
    ) {
      this.parar();
      await this.esperar();
    }
    if (parcial.modo && parcial.modo !== a.modo) await this.novaSessao(id);
    Object.assign(a, parcial);
    if (parcial.papel) a.papel = mascarar(parcial.papel);
    a.estado = a.habilitado ? 'livre' : 'desabilitado';
    await this.storage.gravar('provedores', this.id, id, a);
    this.emitir({ tipo: 'agente', agente: a });
  }
  async configurar(parcial: Partial<Configuracao>, confirmacao?: string): Promise<void> {
    if (parcial.nivel === 'total' && confirmacao !== CONFIRMACAO_NIVEL_TOTAL)
      throw new Error(`Digite ${CONFIRMACAO_NIVEL_TOTAL} para ativar Total.`);
    if (parcial.nivel && parcial.nivel !== this.config.nivel) {
      this.parar();
      await this.esperar();
      for (const a of this.agentes) await this.novaSessao(a.id);
    }
    this.config = {
      ...this.config,
      ...parcial,
      limites: limitar(parcial.limites ?? this.config.limites),
    };
    if (parcial.nivel === 'total') this.config.nivelConfirmadoEm = new Date().toISOString();
    this.config.topico = mascarar(this.config.topico);
    await this.salvar();
    this.emitir({ tipo: 'configuracao', configuracao: this.config });
  }
  async salvar(): Promise<void> {
    await this.storage.gravar('salas', this.id, this.id, {
      configuracao: this.config,
      primeiraExecucao: this.primeiraExecucao,
      projeto: this.projeto,
      ...(this.chat ? { ultimo_chat: this.chat.id } : {}),
    });
  }
  async adicionarAnexo(a: AnexoArmazenado): Promise<void> {
    this.anexos.set(a.meta.id, a);
    this.anexosPendentes.add(a.meta.id);
    await this.storage.gravarDoChat('anexos', this.chat.id, a.meta.id, a);
    await this.storage.pendentesChat(this.chat.id, [a.meta.id], []);
    this.emitir({ tipo: 'anexo', anexo: a.meta });
  }
  removerAnexo(id: string): void {
    this.anexosPendentes.delete(id);
    this.persistir(this.storage.pendentesChat(this.chat.id, [], [id]));
    this.emitir({ tipo: 'anexoRemovido', id });
  }
  async adicionarContexto(c: ContextoCompleto): Promise<void> {
    this.contextos.set(c.meta.id, c);
    await this.storage.gravarDoChat('contextos', this.chat.id, c.meta.id, c);
    this.emitir({ tipo: 'contexto', contexto: c.meta });
  }
  async removerContexto(id: string): Promise<void> {
    this.contextos.delete(id);
    await this.storage.remover('contextos', this.chat.id, id);
    this.emitir({ tipo: 'contextoRemovido', id });
  }
}
