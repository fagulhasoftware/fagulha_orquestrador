import { homedir } from 'node:os';
import { join } from 'node:path';
import type {
  Agente,
  ComponenteVoz,
  DoHost,
  EstadoVoz,
  Mensagem,
  ProgressoInstalacaoVoz,
  FaseAgente,
  PerguntaAgente,
  PacoteAudioVoz,
  ProvedorVozNuvem,
} from '../shared/protocolo';
import {
  carregarConfiguracao,
  salvarConfiguracao,
  padraoVoz,
  estadoInicialVoz,
  type ConfiguracaoVoz,
  type ParcialVoz,
} from './configuracao';
import { detectarVoz, type DetectadoVoz } from './deteccao';
import { Gravador } from './gravador';
import { transcrever, normalizarMencoes } from './transcritor';
import { textoParaLeitura } from './texto';
import { InstaladorVoz } from './instalador';
import { artefato, type ArtefatoVoz } from './catalogo';
import type { FabricaProcesso } from './processo';
import { VozNuvem } from './nuvem';
import type { Segredos } from '../providers/tipos';
import { TurnosVoz, trechoAutomatico } from './turnos';

interface ServicoInstalacao {
  instalar(itens: ArtefatoVoz[]): Promise<void>;
  cancelar(): void;
  finalizar(): Promise<void>;
}
interface OpcoesVoz {
  reproduzir?: (pacote: Omit<PacoteAudioVoz, 'id'>, sinal: AbortSignal) => Promise<void>;
  nuvem?: VozNuvem;
  segredos?: Segredos;
  carregar?: () => Promise<ConfiguracaoVoz | undefined>;
  salvar?: (parcial: ParcialVoz) => Promise<ConfiguracaoVoz>;
  pasta?: string;
  so?: NodeJS.Platform;
  fabrica?: FabricaProcesso;
  emitir: (e: DoHost) => void;
  agentes: () => Agente[];
  enviar: (texto: string) => void;
  auditar: (resumo: string) => Promise<void>;
  detectar?: typeof detectarVoz;
  limiteSegundos?: number;
  instalador?: (pasta: string, emitir: (p: ProgressoInstalacaoVoz) => void) => ServicoInstalacao;
}
export class VozLocal {
  estado: EstadoVoz = estadoInicialVoz();
  private config = padraoVoz();
  private detectado?: DetectadoVoz;
  private pasta: string;
  private arquivoConfig: string;
  private gravador: Gravador;
  private nuvem?: VozNuvem;
  private controleAudio?: AbortController;
  private avisosFallback = new Set<string>();
  private catalogoNota?: string;
  private vozesBrowser: { id: string; nome: string }[] = [];
  private sistemaBrowser = true;
  private modelosNuvem: { id: string; nome: string; vozes?: string[] }[] = [];
  private turnos = new TurnosVoz();
  private execucoes = new Set<string>();
  private instalador: ServicoInstalacao;
  private instalando = false;
  private encerrado = false;
  private iniciando?: Promise<void>;
  private transcricao?: Promise<void>;
  private controle?: AbortController;
  private descartado = false;
  private geracaoLeitura = 0;
  private filaLeitura: Promise<void> = Promise.resolve();
  private lidas = new Set<string>();
  private auditorias: Promise<void> = Promise.resolve();
  private persistencia: Promise<void> = Promise.resolve();
  private tarefaInstalacao?: Promise<void>;
  private finalizacao?: Promise<void>;
  private descarte?: Promise<void>;
  constructor(private opcoes: OpcoesVoz) {
    this.pasta = opcoes.pasta ?? join(homedir(), '.orquestra', 'voz');
    this.arquivoConfig = join(this.pasta, 'configuracao.json');
    this.gravador = new Gravador(join(this.pasta, 'temporarios'), opcoes.fabrica, opcoes.so);
    this.nuvem = opcoes.nuvem ?? (opcoes.segredos ? new VozNuvem(opcoes.segredos) : undefined);
    this.instalador = (opcoes.instalador ?? ((pasta, emitir) => new InstaladorVoz(pasta, emitir)))(
      this.pasta,
      (p) => this.progresso(p),
    );
  }
  private emitir(): void {
    this.opcoes.emitir({ tipo: 'estadoVoz', voz: structuredClone(this.estado) });
  }
  private auditar(resumo: string): void {
    this.auditorias = this.auditorias.catch(() => {}).then(() => this.opcoes.auditar(resumo));
    void this.auditorias.catch(() => {});
  }
  async inicializar(): Promise<EstadoVoz> {
    this.config =
      (await this.opcoes.carregar?.()) ?? (await carregarConfiguracao(this.arquivoConfig));
    if (this.opcoes.salvar && !(await this.opcoes.carregar?.()))
      this.config = await this.opcoes.salvar(this.config);
    return this.detectar();
  }
  async sincronizar(): Promise<void> {
    if (
      this.estado.gravando ||
      this.transcricao ||
      this.iniciando ||
      this.instalando ||
      this.encerrado
    )
      return;
    const config = await this.opcoes.carregar?.();
    const chave = (await this.nuvem?.configurada(this.config.leitura.provedor)) ?? false;
    if (
      (config && JSON.stringify(config) !== JSON.stringify(this.config)) ||
      chave !== this.estado.leitura.nuvem.chaveConfigurada
    ) {
      await this.pararLeitura();
      if (config) this.config = config;
      await this.detectar();
    }
  }
  async detectar(): Promise<EstadoVoz> {
    const d = await (this.opcoes.detectar ?? detectarVoz)(
      this.pasta,
      this.config,
      this.opcoes.so,
      this.opcoes.fabrica,
    );
    this.detectado = d;
    const chaveConfigurada = (await this.nuvem?.configurada(this.config.leitura.provedor)) ?? false;
    d.estado.leitura.nuvem = {
      provedor: this.config.leitura.provedor ?? null,
      chaveConfigurada,
      mascara: await this.nuvem?.mascara(this.config.leitura.provedor),
      nota: this.catalogoNota,
    };
    d.estado.leitura.modelosNuvem = this.modelosNuvem;
    if (this.opcoes.reproduzir) {
      d.estado.leitura.motores = d.estado.leitura.motores.map((m) =>
        m.id === 'sistema' ? { id: 'sistema', disponivel: this.sistemaBrowser } : m,
      );
      if (d.estado.leitura.motor === 'sistema') {
        d.estado.leitura.disponivel = this.sistemaBrowser;
        d.estado.leitura.vozes = this.vozesBrowser;
        d.estado.leitura.motivo = undefined;
      }
    }
    d.estado.leitura.motores = d.estado.leitura.motores.map((m) =>
      m.id === 'nuvem'
        ? {
            id: 'nuvem',
            disponivel: chaveConfigurada,
            motivo: chaveConfigurada
              ? undefined
              : 'Configure uma chave validada para enviar texto ao provedor.',
          }
        : m,
    );
    if (d.estado.leitura.motor === 'nuvem') {
      d.estado.leitura.disponivel = chaveConfigurada || !!this.opcoes.reproduzir;
      d.estado.leitura.vozes = this.config.leitura.vozesNuvem;
      d.estado.leitura.motivo = chaveConfigurada
        ? undefined
        : 'Configure uma chave de voz validada.';
    }
    this.estado = {
      ...d.estado,
      limiteSegundos: this.opcoes.limiteSegundos ?? 120,
      gravando: this.estado.gravando,
      transcrevendo: this.estado.transcrevendo,
      segundosGravados: this.estado.segundosGravados,
      leitura: { ...d.estado.leitura, falando: this.estado.leitura.falando },
    };
    this.emitir();
    return this.estado;
  }
  private verificarLivre(): void {
    if (this.encerrado) throw new Error('O serviço de voz foi encerrado.');
    if (this.estado.gravando || this.transcricao || this.iniciando)
      throw new Error('Aguarde a gravação ou a transcrição terminar.');
  }
  async configurar(
    parcial: Partial<
      Pick<ConfiguracaoVoz, 'dispositivo' | 'modelo' | 'idioma' | 'envioAutomatico'>
    >,
  ): Promise<void> {
    this.verificarLivre();
    if (this.instalando) throw new Error('Aguarde a instalação terminar para alterar a voz.');
    if (parcial.dispositivo && !this.estado.dispositivos.some((d) => d.id === parcial.dispositivo))
      throw new Error('Microfone desconhecido.');
    this.config = { ...this.config, ...parcial };
    await this.salvar(parcial);
    await this.detectar();
  }
  async configurarLeitura(parcial: Partial<ConfiguracaoVoz['leitura']>): Promise<void> {
    if (
      parcial.motor &&
      parcial.motor !== 'nuvem' &&
      !this.estado.leitura.motores.some((m) => m.id === parcial.motor && m.disponivel)
    )
      throw new Error(
        'Este motor de voz ainda nao esta disponivel. Configure seus componentes primeiro.',
      );
    if (parcial.motor === 'nuvem' && this.estado.leitura.motor !== 'nuvem')
      this.opcoes.emitir({
        tipo: 'aviso',
        nivel: 'alerta',
        texto:
          'Voz em nuvem ativada: o texto lido sera enviado ao provedor escolhido e pode gerar cobranca. As demais leituras permanecem locais.',
      });
    if (parcial.provedor && parcial.provedor !== this.config.leitura.provedor) {
      await this.pararLeitura();
      this.modelosNuvem = [];
      this.config.leitura = {
        ...this.config.leitura,
        provedor: parcial.provedor,
        voz: undefined,
        ttsModelo: undefined,
        porAgente: {},
        vozesNuvem: [],
      };
      await this.salvar({ leitura: this.config.leitura });
      if (await this.nuvem?.configurada(parcial.provedor)) await this.atualizarVozes();
      else await this.detectar();
      return;
    }
    if (parcial.ttsModelo && !this.modelosNuvem.some((m) => m.id === parcial.ttsModelo))
      throw Error('Modelo TTS nao anunciado pelo provedor.');
    if (
      parcial.porAgente &&
      Object.entries(parcial.porAgente).some(
        ([id, voz]) =>
          !this.opcoes.agentes().some((a) => a.id === id) ||
          (voz && !this.estado.leitura.vozes.some((v) => v.id === voz)),
      )
    )
      throw Error('Agente ou voz desconhecido.');
    if (parcial.voz && !this.estado.leitura.vozes.some((v) => v.id === parcial.voz))
      throw new Error('Voz nativa desconhecida.');
    await this.pararLeitura();
    this.config = {
      ...this.config,
      leitura: {
        ...this.config.leitura,
        ...parcial,
        ...(parcial.motor && parcial.motor !== this.estado.leitura.motor
          ? {
              voz:
                parcial.motor === 'nuvem'
                  ? (this.config.leitura.vozesNuvem.find((v) => v.id === 'coral')?.id ??
                    this.config.leitura.vozesNuvem[0]?.id)
                  : undefined,
            }
          : {}),
      },
    };
    if (parcial.ttsModelo && this.config.leitura.provedor && this.nuvem) {
      const c = await this.nuvem.catalogo(this.config.leitura.provedor);
      const ids = c.modelos.find((m) => m.id === parcial.ttsModelo)?.vozes;
      this.config.leitura.vozesNuvem = c.vozes.filter((v) => !ids || ids.includes(v.id));
      if (!this.config.leitura.vozesNuvem.some((v) => v.id === this.config.leitura.voz))
        this.config.leitura.voz = this.config.leitura.vozesNuvem[0]?.id;
      this.config.leitura.porAgente = {};
    }
    this.estado.leitura = { ...this.estado.leitura, ...this.config.leitura };
    await this.salvar({
      leitura: this.config.leitura,
    });
    await this.detectar();
  }
  async chaveNuvem(provedor: ProvedorVozNuvem, chave: string): Promise<void> {
    if (!this.nuvem) throw new Error('Armazenamento seguro indisponivel.');
    await this.pararLeitura();
    let vozes = await this.nuvem.salvar(provedor, chave);
    const catalogo = await this.nuvem.catalogo(provedor);
    vozes = vozes.filter(
      (v) => !catalogo.modelos[0]?.vozes || catalogo.modelos[0].vozes!.includes(v.id),
    );
    this.modelosNuvem = catalogo.modelos;
    this.catalogoNota = catalogo.nota;
    this.avisosFallback.clear();
    this.config.leitura = {
      ...this.config.leitura,
      provedor,
      vozesNuvem: vozes,
      ttsModelo: catalogo.modelos[0]?.id,
      porAgente: {},
      ...(this.config.leitura.motor === 'nuvem' ? { voz: vozes[0]?.id } : {}),
    };
    await this.salvar({
      leitura: {
        provedor,
        vozesNuvem: vozes,
        ttsModelo: this.config.leitura.ttsModelo,
        porAgente: {},
        ...(this.config.leitura.motor === 'nuvem' ? { voz: vozes[0]?.id } : {}),
      },
    });
    await this.detectar();
    this.opcoes.emitir({
      tipo: 'aviso',
      nivel: 'info',
      texto:
        'Chave de voz validada e salva com seguranca. Selecione o motor Nuvem para enviar o texto ao provedor.',
    });
  }
  async atualizarVozes(): Promise<void> {
    const p = this.config.leitura.provedor;
    if (!p || !this.nuvem) throw Error('Selecione o provedor e configure a chave.');
    const c = await this.nuvem.catalogo(p, true);
    this.avisosFallback.clear();
    this.modelosNuvem = c.modelos;
    this.catalogoNota = c.nota;
    const modelo = c.modelos.some((m) => m.id === this.config.leitura.ttsModelo)
      ? this.config.leitura.ttsModelo
      : c.modelos[0]?.id;
    const permitidas = c.modelos.find((m) => m.id === modelo)?.vozes;
    const vozes = c.vozes.filter((v) => !permitidas || permitidas.includes(v.id));
    this.config.leitura = {
      ...this.config.leitura,
      ttsModelo: modelo,
      vozesNuvem: vozes,
      voz: vozes.some((v) => v.id === this.config.leitura.voz)
        ? this.config.leitura.voz
        : vozes[0]?.id,
    };
    await this.salvar({ leitura: this.config.leitura });
    await this.detectar();
  }
  registrarVozesSistema(disponivel: boolean, vozes: { id: string; nome: string }[]): void {
    this.sistemaBrowser = disponivel;
    this.vozesBrowser = vozes;
    if (this.opcoes.reproduzir && this.estado.leitura.motor === 'sistema') {
      this.estado.leitura.disponivel = disponivel;
      this.estado.leitura.vozes = vozes;
      this.emitir();
    }
  }
  async testarVoz(): Promise<void> {
    this.avisosFallback.clear();
    const a = this.opcoes.agentes()[0];
    if (!a) throw Error('Nenhum participante para testar a voz.');
    await this.pararLeitura();
    await this.ler({
      id: 'teste-voz',
      sala: '',
      autor: a.nick,
      quando: new Date().toISOString(),
      tipo: 'fala',
      texto: 'Teste de voz do Orquestrador Fagulha. Um mais um e igual a dois.',
    });
  }
  async removerChaveNuvem(): Promise<void> {
    await this.pararLeitura();
    await this.nuvem?.remover(this.config.leitura.provedor);
    this.modelosNuvem = [];
    this.config.leitura = {
      ...this.config.leitura,
      motor: 'sistema',
      provedor: undefined,
      vozesNuvem: [],
      voz: undefined,
    };
    await this.salvar({ leitura: this.config.leitura });
    await this.detectar();
  }
  private salvar(parcial: ParcialVoz = this.config): Promise<void> {
    const config = structuredClone(this.config);
    this.persistencia = this.persistencia
      .catch(() => {})
      .then(async () => {
        if (this.opcoes.salvar) this.config = await this.opcoes.salvar(parcial);
        else await salvarConfiguracao(this.arquivoConfig, config);
      });
    return this.persistencia;
  }
  instalar(componentes: ComponenteVoz[]): Promise<void> {
    this.verificarLivre();
    if (this.instalando) throw new Error('Já existe uma instalação de voz em andamento.');
    const itens = [...new Set(componentes)].flatMap((c) => {
      if (c === 'piper' || c === 'voz_neural')
        throw new Error('Piper removido: use voz do sistema/webview ou nuvem.');
      if (
        ((this.opcoes.so ?? process.platform) !== 'win32' || process.arch !== 'x64') &&
        c !== 'modelo'
      )
        throw new Error('Neste sistema, instale os executáveis pelo comando manual apresentado.');
      return [artefato(c, this.config.modelo)];
    });
    this.instalando = true;
    this.tarefaInstalacao = this.instalarComponentes(itens).finally(() => {
      this.tarefaInstalacao = undefined;
      this.instalando = false;
    });
    return this.tarefaInstalacao;
  }
  private async instalarComponentes(itens: ArtefatoVoz[]): Promise<void> {
    try {
      await this.instalador.instalar(itens);
    } finally {
      if (this.encerrado) return;
      const resultados = this.estado.componentes
        .filter((c) => c.situacao === 'erro')
        .map((c) => structuredClone(c));
      await this.detectar();
      for (const resultado of resultados) {
        const item = this.estado.componentes.find((c) => c.componente === resultado.componente);
        if (item && item.situacao !== 'instalado') Object.assign(item, resultado);
      }
      this.emitir();
    }
  }
  private progresso(p: ProgressoInstalacaoVoz): void {
    const c = this.estado.componentes.find((c) => c.componente === p.componente);
    if (c) {
      c.situacao =
        p.etapa === 'erro'
          ? 'erro'
          : p.etapa === 'concluido'
            ? 'instalado'
            : p.etapa === 'cancelado'
              ? 'ausente'
              : 'instalando';
      c.mensagem = p.mensagem;
    }
    if (['erro', 'concluido', 'cancelado'].includes(p.etapa))
      this.auditar(`voz instalacao ${p.componente} ${p.etapa}`);
    this.opcoes.emitir({ tipo: 'vozInstalacao', progresso: p });
    this.emitir();
  }
  cancelarInstalacao(): void {
    this.instalador.cancelar();
  }
  iniciar(): Promise<void> {
    this.verificarLivre();
    if (this.instalando) throw new Error('Aguarde a instalação terminar para gravar.');
    if (!this.estado.disponivel || !this.detectado?.ffmpeg || !this.estado.dispositivo)
      throw new Error(this.estado.motivo ?? 'Voz indisponível.');
    this.iniciando = this.iniciarGravacao().finally(() => {
      this.iniciando = undefined;
    });
    return this.iniciando;
  }
  private async iniciarGravacao(): Promise<void> {
    await this.pararLeitura();
    if (this.encerrado) return;
    this.descartado = false;
    await this.gravador.iniciar(
      this.detectado!.ffmpeg!,
      this.estado.dispositivo!,
      (segundos) => {
        this.estado.gravando = true;
        this.estado.segundosGravados = segundos;
        this.emitir();
      },
      () => {
        void this.parar().catch(() => {});
      },
      this.estado.limiteSegundos,
    );
    this.opcoes.emitir({ tipo: 'voz', gravando: true });
  }
  async parar(): Promise<void> {
    await this.iniciando;
    if (this.transcricao) return this.transcricao;
    if (!this.gravador.ativo) return;
    this.controle = new AbortController();
    this.transcricao = this.finalizarGravacao(this.controle.signal).finally(() => {
      this.transcricao = undefined;
      this.controle = undefined;
    });
    return this.transcricao;
  }
  private async finalizarGravacao(sinal: AbortSignal): Promise<void> {
    let audio;
    try {
      audio = await this.gravador.parar();
      this.estado.gravando = false;
      if (!audio || this.descartado || sinal.aborted) return;
      this.estado.transcrevendo = true;
      this.emitir();
      const texto = normalizarMencoes(
        await transcrever(
          this.detectado!.whisper!,
          this.detectado!.modelo,
          this.config.idioma,
          audio,
          sinal,
          this.opcoes.fabrica,
        ),
        this.opcoes.agentes(),
      );
      if (sinal.aborted || this.descartado || this.encerrado) return;
      this.auditar(`voz transcricao ${audio.duracao}s`);
      if (this.config.envioAutomatico) this.opcoes.enviar(texto);
      else this.opcoes.emitir({ tipo: 'voz', gravando: false, transcricao: texto });
    } catch {
      if (!sinal.aborted && !this.descartado && !this.encerrado)
        this.opcoes.emitir({
          tipo: 'voz',
          gravando: false,
          erro: 'Não foi possível gravar ou transcrever. Verifique o microfone, o modelo e as permissões do sistema.',
        });
    } finally {
      if (audio) await this.gravador.limpar(audio);
      this.estado.gravando = false;
      this.estado.transcrevendo = false;
      this.estado.segundosGravados = undefined;
      this.emitir();
    }
  }
  descartar(): Promise<void> {
    if (!this.descarte)
      this.descarte = this.descartarGravacao().finally(() => {
        this.descarte = undefined;
      });
    return this.descarte;
  }
  private async descartarGravacao(): Promise<void> {
    await this.iniciando;
    this.descartado = true;
    this.controle?.abort();
    if (this.transcricao) await this.transcricao;
    else await this.gravador.descartar();
    this.estado.gravando = false;
    this.estado.transcrevendo = false;
    this.estado.segundosGravados = undefined;
    this.opcoes.emitir({ tipo: 'voz', gravando: false });
    this.emitir();
  }
  mensagem(m: Mensagem): void {
    const a = this.opcoes.agentes().find((a) => a.nick === m.autor);
    if (!a) return;
    const anuncio = this.turnos.mensagem(a.id, m);
    if (anuncio) this.enfileirar(anuncio);
  }
  fase(agente: string, fase: FaseAgente): void {
    if (!['concluido', 'erro', 'interrompido'].includes(fase.tipo) && !this.execucoes.has(agente)) {
      this.execucoes.add(agente);
      this.turnos.iniciar(agente);
    }
    if (fase.tipo === 'concluido') {
      const resumo = this.turnos.concluir(agente);
      if (resumo) this.enfileirar(resumo);
    }
    if (fase.tipo === 'erro' || fase.tipo === 'interrompido') this.turnos.concluir(agente);
    if (['concluido', 'erro', 'interrompido'].includes(fase.tipo)) this.execucoes.delete(agente);
  }
  pergunta(p: PerguntaAgente): void {
    const a = this.opcoes.agentes().find((a) => a.id === p.agente);
    if (!a) return;
    p.perguntas.forEach((q, indice) =>
      this.enfileirar({
        id: `${p.id}:${q.id}`,
        sala: '',
        quando: p.criadaEm,
        autor: a.nick,
        tipo: 'fala',
        texto: trechoAutomatico(
          [
            indice === 0 ? p.titulo : undefined,
            `${q.pergunta} ${q.opcoes.map((o) => o.rotulo).join('; ')}.`,
          ]
            .filter(Boolean)
            .join(' '),
        ),
      }),
    );
  }
  private enfileirar(m: Mensagem): void {
    if (
      !this.config.leitura.ativa ||
      !this.estado.leitura.disponivel ||
      m.parcial ||
      m.tipo !== 'fala' ||
      !this.opcoes.agentes().some((a) => a.nick === m.autor) ||
      this.lidas.has(m.id)
    )
      return;
    this.lidas.add(m.id);
    if (this.lidas.size > 1000) this.lidas.delete(this.lidas.values().next().value!);
    const geracao = this.geracaoLeitura;
    this.filaLeitura = this.filaLeitura
      .then(async () => {
        if (
          geracao === this.geracaoLeitura &&
          !this.estado.gravando &&
          !this.iniciando &&
          !this.estado.transcrevendo &&
          !this.encerrado
        )
          await this.ler(m);
      })
      .catch(() => {
        this.opcoes.emitir({
          tipo: 'aviso',
          nivel: 'erro',
          texto: 'Não foi possível ler a mensagem com a voz nativa.',
        });
      });
  }
  async ler(m: Mensagem): Promise<void> {
    if (this.estado.gravando || this.iniciando || this.estado.transcrevendo || this.encerrado)
      return;
    if (m.parcial || m.tipo !== 'fala' || !this.opcoes.agentes().some((a) => a.nick === m.autor))
      throw new Error('A leitura está disponível para falas finais dos agentes.');
    if (!this.opcoes.reproduzir) throw new Error('Abra a sala para reproduzir audio pelo webview.');
    await this.lerWebview(m);
  }
  private async lerWebview(m: Mensagem): Promise<void> {
    const controle = new AbortController();
    this.controleAudio?.abort();
    this.controleAudio = controle;
    const a = this.opcoes.agentes().find((a) => a.nick === m.autor),
      l = structuredClone(this.config.leitura);
    const voz = l.porAgente?.[a?.id ?? ''] || l.voz;
    this.estado.leitura.falando = m.id;
    this.emitir();
    try {
      let restante = textoParaLeitura(m.texto, 100000);
      while (restante && !controle.signal.aborted) {
        let fim = Math.min(1500, restante.length);
        if (fim < restante.length) {
          const espaco = restante.lastIndexOf(' ', fim);
          if (espaco > 1000) fim = espaco;
        }
        const texto = restante.slice(0, fim);
        restante = restante.slice(fim).trimStart();
        let audio: { base64: string; mime: 'audio/wav' | 'audio/mpeg' } | undefined;
        if (l.motor === 'nuvem' && l.provedor && !this.avisosFallback.has(l.provedor)) {
          try {
            const gerado = await this.nuvem!.audio(
              l.provedor,
              texto,
              { voz, modelo: l.ttsModelo },
              controle.signal,
            );
            audio = { base64: gerado.dados.toString('base64'), mime: gerado.mime };
          } catch (e) {
            if (controle.signal.aborted) return;
            if (!this.avisosFallback.has(l.provedor)) {
              this.avisosFallback.add(l.provedor);
              this.opcoes.emitir({
                tipo: 'aviso',
                nivel: 'alerta',
                texto:
                  e instanceof Error && e.message.includes('missing_permissions')
                    ? 'Chave de voz sem permissao text_to_speech. Usando a voz do sistema.'
                    : 'Provedor de voz indisponivel (chave, cota ou rede). Usando a voz do sistema.',
              });
            }
          }
        }
        if (!controle.signal.aborted)
          await this.opcoes.reproduzir!(
            {
              texto,
              velocidade: l.velocidade,
              voz: l.motor === 'sistema' ? voz : undefined,
              ...audio,
            },
            controle.signal,
          );
      }
    } catch (e) {
      if (!controle.signal.aborted) throw e;
    } finally {
      if (this.controleAudio === controle) {
        this.controleAudio = undefined;
        this.estado.leitura.falando = undefined;
        this.emitir();
      }
    }
  }
  async pararLeitura(): Promise<void> {
    this.geracaoLeitura++;
    this.controleAudio?.abort();
    this.estado.leitura.falando = undefined;
    this.emitir();
  }
  finalizar(): Promise<void> {
    if (!this.finalizacao) this.finalizacao = this.encerrar();
    return this.finalizacao;
  }
  private async encerrar(): Promise<void> {
    this.encerrado = true;
    this.instalador.cancelar();
    await this.descartar();
    await this.pararLeitura();
    await this.instalador.finalizar();
    await this.tarefaInstalacao;
    await this.filaLeitura;
    await this.persistencia;
    await this.auditorias;
  }
}
