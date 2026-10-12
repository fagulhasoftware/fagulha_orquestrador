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
import { Leitor } from './leitor';
import { InstaladorVoz } from './instalador';
import { artefato, LICENCAS_PIPER, type ArtefatoVoz } from './catalogo';
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
  private leitor: Leitor;
  private nuvem?: VozNuvem;
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
    this.leitor = new Leitor(join(this.pasta, 'temporarios'), opcoes.fabrica, opcoes.so, {
      modelo: () => this.detectado?.vozPiper,
      nuvem: this.nuvem,
    });
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
    d.estado.leitura.nuvem = { provedor: this.config.leitura.provedor ?? null, chaveConfigurada };
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
      d.estado.leitura.disponivel = chaveConfigurada;
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
    this.estado.leitura = { ...this.estado.leitura, ...this.config.leitura };
    await this.salvar({
      leitura: { ...parcial, ...(parcial.motor ? { voz: this.config.leitura.voz } : {}) },
    });
    await this.detectar();
  }
  async chaveNuvem(provedor: 'openai' | 'elevenlabs', chave: string): Promise<void> {
    if (!this.nuvem) throw new Error('Armazenamento seguro indisponivel.');
    const vozes = await this.nuvem.salvar(provedor, chave);
    this.config.leitura = {
      ...this.config.leitura,
      provedor,
      vozesNuvem: vozes,
      ...(this.config.leitura.motor === 'nuvem' ? { voz: vozes[0]?.id } : {}),
    };
    await this.salvar({
      leitura: {
        provedor,
        vozesNuvem: vozes,
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
  async removerChaveNuvem(): Promise<void> {
    await this.pararLeitura();
    await this.nuvem?.remover();
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
      if (
        ((this.opcoes.so ?? process.platform) !== 'win32' || process.arch !== 'x64') &&
        c !== 'modelo' &&
        c !== 'voz_neural'
      )
        throw new Error('Neste sistema, instale os executáveis pelo comando manual apresentado.');
      return c === 'piper'
        ? [...LICENCAS_PIPER, artefato(c, this.config.modelo)]
        : [artefato(c, this.config.modelo)];
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
    const comando =
      this.estado.leitura.motor === 'piper'
        ? this.detectado?.piper
        : this.estado.leitura.motor === 'nuvem'
          ? 'nuvem'
          : this.detectado?.tts;
    if (!comando || !this.estado.leitura.disponivel)
      throw new Error(this.estado.leitura.motivo ?? 'Leitura nativa indisponível.');
    const geracao = this.geracaoLeitura;
    this.estado.leitura.falando = m.id;
    this.emitir();
    try {
      await this.leitor.ler(comando, m.texto, this.estado.leitura);
    } finally {
      if (geracao === this.geracaoLeitura && this.estado.leitura.falando === m.id) {
        this.estado.leitura.falando = undefined;
        this.emitir();
      }
    }
  }
  async pararLeitura(): Promise<void> {
    this.geracaoLeitura++;
    await this.leitor.parar();
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
