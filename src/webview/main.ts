/// <reference lib="dom" />
// Interface de chat do Orquestrador Fagulha (webview). Dono: Claude.
// Fala com o host somente pelos tipos de src/shared/protocolo.ts.
import {
  CONFIRMACAO_NIVEL_TOTAL, VERSAO_PROTOCOLO,
  type Agente, type ComponenteVoz, type DoHost, type EstadoVoz, type ItemInstalacaoVoz, type ModeloVoz, type OpcaoLogin, type ProgressoInstalacaoVoz, type ProgressoLogin, type EstadoSala, type Mensagem, type ModoAgente, type NivelPermissao, type PedidoAprovacao,
} from '../shared/protocolo';
import { renderMarkdown } from './markdown';
import { botaoIcone, bytes, enviar, h, hora, icone, local, ouvir, salvarLocal, type Vista } from './util';

let E: EstadoSala | null = null;
let vista: Vista = local().vista;
let passoAssistente = 0;
// Login (v2): paineis abertos, progresso por agente e campos de chave preservados entre renderizacoes.
const loginAberto = new Set<string>();
const progressos = new Map<string, ProgressoLogin>();
const camposChave = new Map<string, { chave: HTMLInputElement; baseUrl: HTMLInputElement }>();
const app = document.getElementById('app')!;

// ---------- textos ----------
const NIVEIS: Record<NivelPermissao, { titulo: string; resumo: string; itens: string[] }> = {
  manual: {
    titulo: 'Manual',
    resumo: 'Voce aprova 100% das acoes dos agentes.',
    itens: ['Toda leitura, escrita, comando e acesso a rede pede sua aprovacao.', 'Os agentes trabalham em modo somente leitura e pedem cada alteracao.'],
  },
  parcial: {
    titulo: 'Parcial',
    resumo: 'Livre dentro do projeto; aprovacao para o resto.',
    itens: ['Leitura e escrita dentro da pasta do projeto seguem o modo de cada agente.', 'Pedem aprovacao: arquivos fora do projeto, comandos, navegador externo e sistemas externos.'],
  },
  total: {
    titulo: 'Total',
    resumo: 'Acesso completo ao computador, com aviso de cada acao.',
    itens: ['Os agentes agem sem esperar e informam cada acao na sala.', 'Continuam pedindo aprovacao: apagar ou sobrescrever dados, publicar ou enviar para fora, usar credenciais.'],
  },
};
const RISCOS_TOTAL = [
  'Os agentes poderao ler, criar, alterar e executar programas em qualquer pasta do computador, nao so no projeto.',
  'Um erro do agente ou uma instrucao maliciosa vinda de um arquivo ou pagina web pode alterar ou expor dados antes que voce perceba.',
  'Arquivos com segredos (.env, chaves, bancos locais) ficam ao alcance dos agentes; o Orquestrador bloqueia os conhecidos, mas nao todos.',
  'Voce continua sendo avisado de cada acao e aprovando as criticas, mas as demais nao esperam sua resposta.',
];
const MODOS: Record<ModoAgente, string> = { leitura_escrita: 'Leitura e escrita', leitura: 'So leitura', escrita: 'So escrita' };
const CATEGORIAS: Record<string, string> = {
  leitura_workspace: 'Ler no projeto', escrita_workspace: 'Escrever no projeto', leitura_maquina: 'Ler fora do projeto',
  escrita_maquina: 'Escrever fora do projeto', comando: 'Executar comando', rede_leitura: 'Acessar a web', navegador: 'Navegador externo',
  externo: 'Sistema externo', publicacao: 'Publicar ou enviar', credencial: 'Usar credencial', destrutiva: 'Acao destrutiva',
};
const LOGIN: Record<string, string> = { conectado: 'conectado', chave_configurada: 'chave configurada', desconectado: 'desconectado', desconhecido: 'login desconhecido' };

// ---------- estrutura fixa ----------
const cabecalho = h('header', { class: 'cab' });
const faixa = h('nav', { class: 'faixa', 'aria-label': 'Agentes na sala' });
const painelAprov = h('section', { class: 'aprovacoes', 'aria-live': 'assertive' });
const lista = h('main', { class: 'lista', 'aria-live': 'polite' });
const composer = h('footer', { class: 'composer' });
const vistaExtra = h('section', { class: 'vista' });
app.append(cabecalho, faixa, painelAprov, lista, composer, vistaExtra);

// ---------- cabecalho ----------
function renderCabecalho(): void {
  if (!E) return;
  const trabalhando = E.agentes.some((a) => a.estado === 'trabalhando');
  cabecalho.replaceChildren(
    h('div', { class: 'titulo' },
      h('span', { class: 'canal', title: 'Orquestrador Fagulha' }, '#fagulha_orquestrador'),
      h('span', { class: 'projeto', title: E.sala.projeto ?? 'sem pasta aberta' }, E.sala.titulo)),
    h('div', { class: 'acoes' },
      trabalhando ? botaoIcone('parar', 'Parar o agente atual', () => enviar({ tipo: 'parar' }), 'perigo') : null,
      h('span', { class: `nivel n-${E.configuracao.nivel}`, title: `Nivel de permissao: ${NIVEIS[E.configuracao.nivel].titulo}` },
        icone('escudo'), NIVEIS[E.configuracao.nivel].titulo),
      btnLeitura,
      botaoIcone('pessoas', 'Agentes', () => irPara(vista === 'agentes' ? 'chat' : 'agentes'), vista === 'agentes' ? 'ativo' : ''),
      botaoIcone('engrenagem', 'Configuracoes', () => irPara(vista === 'config' ? 'chat' : 'config'), vista === 'config' ? 'ativo' : '')),
  );
}

// ---------- faixa de agentes ----------
function chipAgente(a: Agente): HTMLElement {
  const desc = !a.instalado ? 'nao instalado' : !a.habilitado ? 'desabilitado' : `${a.estado.replace('_', ' ')} - ${LOGIN[a.login]} - ${MODOS[a.modo]}`;
  return h('button', {
    class: `chip ag c-${a.cor} e-${a.habilitado && a.instalado ? a.estado : 'desabilitado'}`, type: 'button',
    title: `${a.nick}: ${desc}${a.papel ? `\nPapel: ${a.papel}` : ''}\nClique para mencionar`,
    onclick: () => mencionar(a.nick),
  }, h('span', { class: 'ponto' }), a.nick, a.login === 'desconectado' ? h('span', { class: 'alerta' }, '!') : null);
}
function renderFaixa(): void {
  if (!E) return;
  const ativos = E.agentes.filter((a) => a.instalado && a.habilitado);
  faixa.replaceChildren(
    ...ativos.map(chipAgente),
    ...(ativos.length ? [] : [h('span', { class: 'vazio' }, 'Nenhum agente habilitado.')]),
    h('button', { class: 'chip mais', type: 'button', title: 'Gerenciar agentes', onclick: () => irPara('agentes') }, icone('mais')),
  );
}

// ---------- aprovacoes ----------
function cartaoAprovacao(p: PedidoAprovacao): HTMLElement {
  const agente = E?.agentes.find((a) => a.id === p.agente);
  const responder = (decisao: 'aprovar' | 'aprovar_sessao' | 'negar') => enviar({ tipo: 'responderAprovacao', id: p.id, decisao });
  return h('article', { class: `aprov ${p.critica ? 'critica' : ''}`, role: 'alertdialog', 'aria-label': `Pedido de ${agente?.nick ?? p.agente}` },
    h('div', { class: 'aprov-topo' },
      h('span', { class: `quem c-${agente?.cor ?? 'azul'}` }, agente?.nick ?? p.agente),
      h('span', { class: 'cat' }, CATEGORIAS[p.categoria] ?? p.categoria),
      p.critica ? h('span', { class: 'cat critica' }, 'critica') : null,
      p.expiraEm ? h('span', { class: 'expira', 'data-expira': p.expiraEm }) : null),
    h('p', { class: 'resumo' }, p.resumo),
    p.detalhe ? h('pre', { class: 'detalhe' }, p.detalhe) : null,
    h('div', { class: 'botoes' },
      h('button', { class: 'btn primario', type: 'button', onclick: () => responder('aprovar') }, 'Aprovar'),
      p.critica ? null : h('button', { class: 'btn', type: 'button', title: 'Aprova este tipo de acao deste agente ate o fim da sessao', onclick: () => responder('aprovar_sessao') }, 'Aprovar na sessao'),
      h('button', { class: 'btn perigo', type: 'button', onclick: () => responder('negar') }, 'Negar')));
}
function renderAprovacoes(): void {
  painelAprov.replaceChildren(...(E?.aprovacoes ?? []).map(cartaoAprovacao));
  painelAprov.hidden = !E?.aprovacoes.length;
  atualizarContagens();
}
function atualizarContagens(): void {
  for (const el of Array.from(painelAprov.querySelectorAll<HTMLElement>('.expira'))) {
    const s = Math.max(0, Math.round((Date.parse(el.dataset.expira ?? '') - Date.now()) / 1000));
    el.textContent = s > 0 ? `nega em ${s}s` : 'expirando';
  }
}
setInterval(atualizarContagens, 1000);

// ---------- mensagens ----------
const cache = new Map<string, { chave: string; el: HTMLElement }>();
let fimAnteriores = false;

function elMensagem(m: Mensagem): HTMLElement {
  const chave = `${m.tipo}|${m.parcial ? 1 : 0}|${m.texto}|${(m.anexos ?? []).map((a) => a.id).join(',')}|${E?.voz.leitura.disponivel ? 1 : 0}|${E?.voz.leitura.falando === m.id ? 1 : 0}`;
  const c = cache.get(m.id);
  if (c && c.chave === chave) return c.el;
  let el: HTMLElement;
  const ag = E?.agentes.find((a) => a.nick === m.autor);
  if (m.tipo === 'fala') {
    const anexos = m.anexos ?? [];
    el = h('article', { class: `msg fala ${ag ? `c-${ag.cor}` : 'usuario'} ${m.parcial ? 'parcial' : ''}` },
      h('div', { class: 'msg-topo' }, h('span', { class: 'autor' }, m.autor), h('time', { datetime: m.quando }, hora(m.quando)), ag ? botaoOuvir(m) : null),
      renderMarkdown(m.texto),
      anexos.length ? h('div', { class: 'msg-anexos' }, ...anexos.map((a) => h('span', { class: `chip anexo-mini t-${a.tipo}` }, icone('clipe'), a.nome))) : null);
  } else if (m.tipo === 'acao') {
    el = h('div', { class: `msg acao ${ag ? `c-${ag.cor}` : ''}` }, h('time', {}, hora(m.quando)), h('span', { class: 'autor' }, m.autor), ' ', m.texto);
  } else {
    el = h('div', { class: `msg ${m.tipo}`, role: m.tipo === 'erro' ? 'alert' : undefined }, m.texto);
  }
  cache.set(m.id, { chave, el });
  return el;
}

// Acoes consecutivas do mesmo agente viram um grupo recolhivel quando passam de 3.
function renderMensagens(): void {
  if (!E) return;
  const perto = lista.scrollHeight - lista.scrollTop - lista.clientHeight < 80;
  const filhos: HTMLElement[] = [];
  if (!fimAnteriores && E.mensagens.length) {
    filhos.push(h('button', { class: 'btn fantasma anteriores', type: 'button', onclick: () => enviar({ tipo: 'carregarAnteriores', antesDe: E!.mensagens[0].id }) }, 'Carregar mensagens anteriores'));
  }
  const ms = E.mensagens;
  for (let i = 0; i < ms.length; i++) {
    if (ms[i].tipo === 'acao') {
      let j = i;
      while (j + 1 < ms.length && ms[j + 1].tipo === 'acao' && ms[j + 1].autor === ms[i].autor) j++;
      const grupo = ms.slice(i, j + 1);
      if (grupo.length > 3) {
        const det = h('details', { class: 'grupo-acoes' },
          h('summary', {}, `${ms[i].autor}: ${grupo.length} acoes`, h('span', { class: 'ultima' }, ` - ${grupo.at(-1)!.texto}`)),
          ...grupo.map(elMensagem));
        filhos.push(det);
        i = j;
        continue;
      }
    }
    filhos.push(elMensagem(ms[i]));
  }
  if (!ms.length) filhos.push(boasVindas());
  lista.replaceChildren(...filhos);
  if (perto) lista.scrollTop = lista.scrollHeight;
}

function boasVindas(): HTMLElement {
  const nomes = E?.agentes.filter((a) => a.habilitado && a.instalado).map((a) => `@${a.nick.toLowerCase()}`) ?? [];
  return h('div', { class: 'boas-vindas' },
    h('h2', {}, 'Sala vazia'),
    h('p', {}, nomes.length ? `Mencione ${nomes.join(', ')} ou @todos para acionar. Sem mencao, a mensagem fica so registrada.` : 'Habilite um agente para comecar.'),
    h('p', { class: 'nota' }, 'Tudo o que acontece aqui fica gravado somente neste computador.'));
}

let agendado = false;
function renderMensagensDepois(): void {
  if (agendado) return;
  agendado = true;
  requestAnimationFrame(() => { agendado = false; renderMensagens(); });
}

// ---------- composer ----------
const chipsComposer = h('div', { class: 'chips-composer' });
const texto = h('textarea', { class: 'entrada', rows: 1, placeholder: 'Mensagem para a sala. Use @ para mencionar.', 'aria-label': 'Mensagem' });
const sugestoes = h('ul', { class: 'sugestoes', role: 'listbox', hidden: true });
const barraGravacao = h('div', { class: 'barra-gravacao', role: 'status', hidden: true });
const btnVoz = botaoIcone('mic', 'Falar (transcricao local)', () => alternarVoz());
const btnLeitura = botaoIcone('som', 'Leitura automatica das respostas', () => { if (E) enviar({ tipo: 'leituraConfigurar', ativa: !E.voz.leitura.ativa }); });
const btnEnviar = h('button', { class: 'bi enviar', type: 'button', title: 'Enviar (Enter)', 'aria-label': 'Enviar', onclick: () => enviarMensagem() }, icone('enviar'));
const avisoLocal = h('div', { class: 'aviso-local', role: 'status', hidden: true });
composer.append(
  avisoLocal, barraGravacao, chipsComposer,
  h('div', { class: 'caixa' }, sugestoes, texto),
  h('div', { class: 'barra' },
    botaoIcone('clipe', 'Anexar arquivos', () => enviar({ tipo: 'anexarArquivos' })),
    botaoIcone('contexto', 'Adicionar contexto de outro chat', () => enviar({ tipo: 'importarContexto' })),
    btnVoz,
    h('span', { class: 'dica' }, 'Enter envia, Shift+Enter quebra linha'),
    btnEnviar));
texto.value = local().rascunho;

function ajustarAltura(): void { texto.style.height = 'auto'; texto.style.height = `${Math.min(texto.scrollHeight, 220)}px`; }
function renderChipsComposer(): void {
  if (!E) return;
  const ctx = E.contextos.map((c) => h('span', { class: 'chip ctx', title: `${c.origem} - ${c.caracteres.toLocaleString('pt-BR')} caracteres` },
    icone('contexto'), c.titulo, h('button', { class: 'x', type: 'button', 'aria-label': `Remover contexto ${c.titulo}`, onclick: () => enviar({ tipo: 'removerContexto', id: c.id }) }, icone('fechar'))));
  const anx = E.anexosPendentes.map((a) => h('span', { class: `chip anexo t-${a.tratamento}`, title: a.aviso ?? `${a.tipo} - ${bytes(a.bytes)}` },
    a.miniatura ? h('img', { src: a.miniatura, alt: '' }) : icone('clipe'),
    h('span', { class: 'nome' }, a.nome),
    h('span', { class: 'meta' }, a.tratamento === 'integral' ? bytes(a.bytes) : a.tratamento),
    h('button', { class: 'x', type: 'button', 'aria-label': `Remover ${a.nome}`, onclick: () => enviar({ tipo: 'removerAnexo', id: a.id }) }, icone('fechar'))));
  chipsComposer.replaceChildren(...ctx, ...anx);
  chipsComposer.hidden = !ctx.length && !anx.length;
}

function enviarMensagem(): void {
  const t = texto.value.trim();
  const anexos = (E?.anexosPendentes ?? []).filter((a) => a.tratamento !== 'recusado').map((a) => a.id);
  if (!t && !anexos.length) return;
  enviar({ tipo: 'enviar', texto: t, anexos });
  texto.value = ''; salvarLocal({ rascunho: '' }); ajustarAltura(); fecharSugestoes();
}

function mencionar(nick: string): void {
  const m = `@${nick.toLowerCase()} `;
  if (!texto.value.includes(m)) texto.value = (texto.value && !texto.value.endsWith(' ') ? texto.value + ' ' : texto.value) + m;
  irPara('chat'); texto.focus(); ajustarAltura();
}

// Autocompletar de mencoes.
let selecionada = 0;
function termoMencao(): { inicio: number; termo: string } | null {
  const ate = texto.value.slice(0, texto.selectionStart ?? 0);
  const m = ate.match(/(^|\s)@([\w-]*)$/);
  return m ? { inicio: ate.length - m[2].length - 1, termo: m[2].toLowerCase() } : null;
}
function opcoesMencao(termo: string): { valor: string; rotulo: string }[] {
  const ops = (E?.agentes ?? []).filter((a) => a.habilitado && a.instalado)
    .map((a) => ({ valor: a.nick.toLowerCase(), rotulo: `${a.nick}${a.papel ? ` - ${a.papel.slice(0, 40)}` : ''}`, chaves: [a.nick.toLowerCase(), ...a.apelidos] }));
  ops.push({ valor: 'todos', rotulo: 'todos - aciona todos os agentes', chaves: ['todos'] });
  return ops.filter((o) => o.chaves.some((k) => k.startsWith(termo)));
}
function atualizarSugestoes(): void {
  const t = termoMencao();
  const ops = t ? opcoesMencao(t.termo) : [];
  if (!ops.length) return fecharSugestoes();
  selecionada = Math.min(selecionada, ops.length - 1);
  sugestoes.replaceChildren(...ops.map((o, i) => h('li', {
    role: 'option', 'aria-selected': i === selecionada ? 'true' : 'false', class: i === selecionada ? 'sel' : '',
    onmousedown: (e: Event) => { e.preventDefault(); aplicarSugestao(o.valor); },
  }, `@${o.rotulo}`)));
  sugestoes.hidden = false;
}
function fecharSugestoes(): void { sugestoes.hidden = true; selecionada = 0; }
function aplicarSugestao(valor: string): void {
  const t = termoMencao(); if (!t) return;
  const fim = texto.selectionStart ?? texto.value.length;
  texto.value = `${texto.value.slice(0, t.inicio)}@${valor} ${texto.value.slice(fim)}`;
  const pos = t.inicio + valor.length + 2;
  texto.setSelectionRange(pos, pos); fecharSugestoes(); salvarLocal({ rascunho: texto.value });
}

texto.addEventListener('input', () => { ajustarAltura(); atualizarSugestoes(); salvarLocal({ rascunho: texto.value }); });
texto.addEventListener('keydown', (e) => {
  if (!sugestoes.hidden) {
    const n = sugestoes.children.length;
    if (e.key === 'ArrowDown') { e.preventDefault(); selecionada = (selecionada + 1) % n; return atualizarSugestoes(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); selecionada = (selecionada - 1 + n) % n; return atualizarSugestoes(); }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const t = termoMencao(); const ops = t ? opcoesMencao(t.termo) : [];
      if (ops[selecionada]) aplicarSugestao(ops[selecionada].valor);
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); return fecharSugestoes(); }
  }
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); enviarMensagem(); }
});
texto.addEventListener('blur', () => setTimeout(fecharSugestoes, 100));

// ---------- anexos por colar e arrastar ----------
// Pre-verificacao no webview para nao trafegar arquivos enormes; o host aplica os limites definitivos.
const EXT_PLANILHA = /\.(xlsx|xlsm|xlsb|xls|ods|tsv)$/i;
const EXT_IMAGEM = /\.(png|jpe?g|webp|gif)$/i;
const EXT_DOC = /\.(pdf|docx)$/i;
function limiteBytes(nome: string, tam: number): { max: number; rotulo: string } {
  const l = E!.configuracao.limites;
  if (EXT_PLANILHA.test(nome) || (/\.csv$/i.test(nome) && tam > l.textoIntegralKB * 1024)) return { max: l.planilhaMaxMB, rotulo: 'planilha' };
  if (EXT_IMAGEM.test(nome)) return { max: l.imagemMaxMB, rotulo: 'imagem' };
  if (EXT_DOC.test(nome)) return { max: l.documentoMaxMB, rotulo: 'documento' };
  return { max: l.textoMaxMB, rotulo: 'arquivo' };
}
function avisar(t: string): void {
  avisoLocal.textContent = t; avisoLocal.hidden = false;
  clearTimeout((avisar as unknown as { t?: number }).t);
  (avisar as unknown as { t?: number }).t = window.setTimeout(() => { avisoLocal.hidden = true; }, 7000);
}
function anexarArquivo(f: File): void {
  if (!E) return;
  const nome = f.name || `colado-${Date.now()}.${(f.type.split('/')[1] || 'bin').replace('jpeg', 'jpg')}`;
  const { max, rotulo } = limiteBytes(nome, f.size);
  if (f.size > max * 1024 * 1024) {
    avisar(`${nome} recusado: ${rotulo} com ${bytes(f.size)} passa do limite de ${max} MB.${rotulo === 'planilha' ? ' Planilhas grandes nao sao processadas; envie um recorte.' : ''}`);
    return;
  }
  const r = new FileReader();
  r.onload = () => {
    const base64 = String(r.result).split(',')[1] ?? '';
    enviar({ tipo: 'anexarDados', nome, mime: f.type || 'application/octet-stream', base64 });
  };
  r.readAsDataURL(f);
}
texto.addEventListener('paste', (e) => {
  const arquivos = Array.from(e.clipboardData?.files ?? []);
  if (arquivos.length) { e.preventDefault(); arquivos.forEach(anexarArquivo); }
});
let profundidadeArraste = 0;
app.addEventListener('dragenter', (e) => { e.preventDefault(); profundidadeArraste++; app.classList.add('arrastando'); });
app.addEventListener('dragleave', () => { if (--profundidadeArraste <= 0) { profundidadeArraste = 0; app.classList.remove('arrastando'); } });
app.addEventListener('dragover', (e) => e.preventDefault());
app.addEventListener('drop', (e) => {
  e.preventDefault(); profundidadeArraste = 0; app.classList.remove('arrastando');
  const arquivos = Array.from(e.dataTransfer?.files ?? []);
  if (arquivos.length) return arquivos.forEach(anexarArquivo);
  // Arrastado do Explorer do VS Code: chega como lista de URIs.
  const uris = (e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('application/vnd.code.uri-list') || '')
    .split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
  if (uris.length) enviar({ tipo: 'anexarCaminhos', uris });
});

// ---------- voz: falar e ouvir (v3) ----------
const progressoVoz = new Map<ComponenteVoz, ProgressoInstalacaoVoz>();
const NOMES_MODELO: Record<ModeloVoz, string> = {
  base: 'base (~150 MB, mais rapido)',
  small: 'small (~490 MB, recomendado para portugues)',
  medium: 'medium (~1,5 GB, mais preciso e mais lento)',
};
const minSeg = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function alternarVoz(): void {
  if (!E) return;
  if (E.voz.transcrevendo) return;
  if (!E.voz.disponivel) {
    avisar(E.voz.motivo ?? 'Voz ainda nao configurada.');
    irPara('config');
    requestAnimationFrame(() => document.getElementById('config-voz')?.scrollIntoView({ block: 'start' }));
    return;
  }
  if (E.voz.leitura.falando) enviar({ tipo: 'pararLeitura' });
  enviar({ tipo: E.voz.gravando ? 'vozParar' : 'vozIniciar' });
}

function renderVoz(): void {
  if (!E) return;
  const v = E.voz;
  btnVoz.classList.toggle('gravando', v.gravando);
  btnVoz.classList.toggle('indisponivel', !v.disponivel);
  btnVoz.classList.toggle('ocupado', v.transcrevendo);
  btnVoz.title = !v.disponivel ? `Configurar voz: ${v.motivo ?? ''}` : v.transcrevendo ? 'Transcrevendo...' : v.gravando ? 'Parar e transcrever' : 'Falar (transcricao local)';
  btnVoz.setAttribute('aria-pressed', v.gravando ? 'true' : 'false');
  if (v.gravando || v.transcrevendo) {
    const seg = v.segundosGravados ?? 0;
    barraGravacao.replaceChildren(
      v.transcrevendo
        ? h('span', {}, h('span', { class: 'girando', 'aria-hidden': 'true' }), ' Transcrevendo no seu computador...')
        : h('span', {}, h('span', { class: 'ponto-gravando', 'aria-hidden': 'true' }), ` Gravando ${minSeg(seg)} / ${minSeg(v.limiteSegundos)}`),
      ...(v.gravando ? [h('span', { class: 'acoes-gravacao' },
        h('button', { class: 'btn pequeno primario', type: 'button', onclick: () => enviar({ tipo: 'vozParar' }) }, v.envioAutomatico ? 'Parar e enviar' : 'Parar e transcrever'),
        h('button', { class: 'btn pequeno', type: 'button', onclick: () => enviar({ tipo: 'vozDescartar' }) }, 'Descartar'))] : []));
    barraGravacao.hidden = false;
  } else {
    barraGravacao.hidden = true;
  }
  btnLeitura.classList.toggle('ativo', v.leitura.ativa);
  btnLeitura.hidden = !v.leitura.disponivel;
  btnLeitura.title = v.leitura.ativa ? 'Leitura automatica das respostas: ligada' : 'Leitura automatica das respostas: desligada';
  btnLeitura.setAttribute('aria-pressed', v.leitura.ativa ? 'true' : 'false');
}

// Botao "ouvir" de cada fala de agente.
function botaoOuvir(m: Mensagem): HTMLElement | null {
  if (!E?.voz.leitura.disponivel || m.parcial) return null;
  const falando = E.voz.leitura.falando === m.id;
  return h('button', {
    class: `bi ouvir ${falando ? 'ativo' : ''}`, type: 'button',
    title: falando ? 'Parar leitura' : 'Ouvir esta resposta', 'aria-label': falando ? 'Parar leitura' : 'Ouvir esta resposta',
    onclick: () => enviar(falando ? { tipo: 'pararLeitura' } : { tipo: 'lerMensagem', id: m.id }),
  }, icone(falando ? 'parar' : 'som'));
}

function secaoVoz(): HTMLElement {
  const v = E!.voz;
  const faltando = v.componentes.filter((c) => c.situacao === 'ausente' || c.situacao === 'erro');
  const instalando = v.componentes.some((c) => c.situacao === 'instalando');
  const total = faltando.reduce((s, c) => s + (c.tamanhoBytes ?? 0), 0);

  const linhaComponente = (c: ItemInstalacaoVoz) => {
    const p = progressoVoz.get(c.componente);
    const pct = p?.totalBytes ? Math.round(((p.baixadoBytes ?? 0) / p.totalBytes) * 100) : undefined;
    return h('li', { class: `comp-voz s-${c.situacao}` },
      h('div', { class: 'linha' },
        h('strong', {}, c.nome),
        h('span', { class: 'estado-comp' }, ({ instalado: 'instalado', ausente: 'nao instalado', instalando: 'instalando', erro: 'erro', manual: 'instalacao manual' } as const)[c.situacao]),
        c.tamanhoBytes && c.situacao !== 'instalado' ? h('span', { class: 'nota' }, bytes(c.tamanhoBytes)) : null,
        c.origem && c.situacao !== 'instalado' ? h('span', { class: 'nota' }, `de ${c.origem}`) : null),
      c.situacao === 'instalando' && p
        ? h('div', { class: 'progresso-voz' },
          h('progress', { max: 100, value: pct ?? 0, 'aria-label': `Progresso de ${c.nome}` }),
          h('span', { class: 'nota' }, p.etapa === 'baixando' ? `${pct ?? 0}%${p.totalBytes ? ` de ${bytes(p.totalBytes)}` : ''}` : p.etapa === 'verificando' ? 'conferindo integridade...' : p.etapa === 'extraindo' ? 'extraindo...' : (p.mensagem ?? '')))
        : null,
      c.situacao === 'manual' && c.comandoManual
        ? h('div', { class: 'comando-manual' }, h('code', {}, c.comandoManual),
          botaoIcone('copiar', 'Copiar comando', () => void navigator.clipboard.writeText(c.comandoManual!)))
        : null,
      c.mensagem && (c.situacao === 'erro' || c.situacao === 'manual') ? h('p', { class: `nota ${c.situacao === 'erro' ? 'erro-texto' : ''}` }, c.mensagem) : null);
  };

  const selecao = <T extends string>(rotulo: string, valor: string | undefined, opcoes: [string, string][], aoMudar: (v: T) => void, desabilitado = false) => {
    const s = h('select', { class: 'campo', disabled: desabilitado }, ...opcoes.map(([id, nome]) => h('option', { value: id, selected: id === (valor ?? '') }, nome)));
    s.addEventListener('change', () => aoMudar(s.value as T));
    return h('label', { class: 'rotulo' }, rotulo, s);
  };
  const caixa = (rotulo: string, marcado: boolean, aoMudar: (v: boolean) => void) => {
    const c = h('input', { type: 'checkbox', checked: marcado });
    c.addEventListener('change', () => aoMudar(c.checked));
    return h('label', { class: 'caixa' }, c, ` ${rotulo}`);
  };
  const velocidade = h('input', { type: 'range', min: 0.5, max: 2, step: 0.1, value: v.leitura.velocidade, 'aria-label': 'Velocidade da leitura' });
  const rotuloVel = h('span', { class: 'nota' }, `${v.leitura.velocidade.toFixed(1)}x`);
  velocidade.addEventListener('input', () => { rotuloVel.textContent = `${Number(velocidade.value).toFixed(1)}x`; });
  velocidade.addEventListener('change', () => enviar({ tipo: 'leituraConfigurar', velocidade: Number(velocidade.value) }));

  return h('section', { id: 'config-voz', class: 'secao-voz' },
    h('h3', {}, 'Voz'),
    h('p', { class: 'nota' }, 'Fala e audio sao processados somente neste computador. A gravacao e apagada logo apos a transcricao.'),
    h('h4', {}, 'Falar'),
    h('ul', { class: 'lista-comp' }, ...v.componentes.map(linhaComponente)),
    faltando.length && !instalando
      ? h('div', { class: 'consentimento' },
        h('p', {}, `Para usar a voz, o Orquestrador precisa baixar ${faltando.length === 1 ? 'um componente' : `${faltando.length} componentes`}${total ? ` (${bytes(total)} no total)` : ''} das fontes oficiais listadas acima. Os arquivos ficam em ~/.orquestra/voz, sem alterar o sistema.`),
        h('button', { class: 'btn primario', type: 'button', onclick: () => enviar({ tipo: 'vozInstalar', componentes: faltando.map((c) => c.componente) }) }, `Baixar e instalar${total ? ` (${bytes(total)})` : ''}`))
      : null,
    instalando ? h('button', { class: 'btn pequeno', type: 'button', onclick: () => enviar({ tipo: 'vozCancelarInstalacao' }) }, 'Cancelar instalacao') : null,
    h('div', { class: 'grade' },
      selecao('Microfone', v.dispositivo, [['', 'Padrao do sistema'], ...v.dispositivos.map((d) => [d.id, d.nome] as [string, string])], (d) => enviar({ tipo: 'vozConfigurar', dispositivo: d }), !v.dispositivos.length),
      selecao<ModeloVoz>('Modelo de transcricao', v.modelo, (Object.keys(NOMES_MODELO) as ModeloVoz[]).map((m) => [m, NOMES_MODELO[m]]), (m) => enviar({ tipo: 'vozConfigurar', modelo: m })),
      selecao<EstadoVoz['idioma']>('Idioma da fala', v.idioma, [['pt', 'Portugues'], ['en', 'Ingles'], ['es', 'Espanhol'], ['auto', 'Detectar automaticamente']], (i) => enviar({ tipo: 'vozConfigurar', idioma: i }))),
    caixa('Enviar a mensagem automaticamente apos transcrever', v.envioAutomatico, (b) => enviar({ tipo: 'vozConfigurar', envioAutomatico: b })),
    h('p', { class: 'nota' }, `Cada gravacao tem no maximo ${minSeg(v.limiteSegundos)}.`),
    h('h4', {}, 'Ouvir'),
    !v.leitura.disponivel
      ? h('p', { class: 'nota' }, v.leitura.motivo ?? 'Nenhuma voz do sistema foi encontrada.')
      : h('div', { class: 'pilha' },
        caixa('Ler automaticamente as respostas dos agentes', v.leitura.ativa, (b) => enviar({ tipo: 'leituraConfigurar', ativa: b })),
        h('div', { class: 'grade' },
          selecao('Voz', v.leitura.voz, v.leitura.vozes.map((x) => [x.id, x.nome] as [string, string]), (id) => enviar({ tipo: 'leituraConfigurar', voz: id }), !v.leitura.vozes.length),
          h('label', { class: 'rotulo' }, 'Velocidade', h('span', { class: 'linha' }, velocidade, rotuloVel))),
        h('p', { class: 'nota' }, 'A leitura usa a voz instalada no seu sistema operacional. Blocos de codigo nao sao lidos.')));
}

// ---------- vistas: agentes e configuracoes ----------
function irPara(v: Vista): void { vista = v; salvarLocal({ vista: v }); renderTudo(); }

function cartaoAgente(a: Agente): HTMLElement {
  const papel = h('textarea', { class: 'campo', rows: 2, placeholder: 'Papel deste agente na sala', 'aria-label': `Papel de ${a.nick}` });
  papel.value = a.papel;
  papel.addEventListener('change', () => enviar({ tipo: 'agentePapel', id: a.id, papel: papel.value.trim() }));
  const modo = h('select', { class: 'campo', 'aria-label': `Modo de ${a.nick}`, disabled: !a.habilitado },
    ...(Object.keys(MODOS) as ModoAgente[]).map((m) => h('option', { value: m, selected: m === a.modo }, MODOS[m])));
  modo.addEventListener('change', () => enviar({ tipo: 'agenteModo', id: a.id, modo: modo.value as ModoAgente }));
  const chave = h('input', { type: 'checkbox', checked: a.habilitado, disabled: !a.instalado, 'aria-label': `Habilitar ${a.nick}` });
  chave.addEventListener('change', () => enviar({ tipo: 'agenteHabilitar', id: a.id, habilitado: chave.checked }));
  return h('article', { class: `cartao-ag c-${a.cor} ${a.habilitado ? '' : 'off'}` },
    h('div', { class: 'linha' },
      h('span', { class: 'ponto' }),
      h('strong', {}, a.nick),
      h('span', { class: 'tag' }, a.tipo === 'cli' ? 'CLI' : 'API'),
      a.origem !== 'embutido' ? h('span', { class: 'tag' }, a.origem) : null,
      h('label', { class: 'interruptor' }, chave, h('span', { class: 'trilho' }))),
    h('div', { class: 'linha sub' },
      !a.instalado ? h('span', { class: 'estado ruim' }, 'nao instalado')
        : h('span', { class: `estado ${a.login === 'conectado' || a.login === 'chave_configurada' ? 'bom' : 'ruim'}` }, LOGIN[a.login]),
      a.versao ? h('span', { class: 'versao' }, a.versao) : null,
      botaoLogin(a),
      a.tipo === 'api' || a.origem === 'manifesto'
        ? h('button', { class: 'btn fantasma pequeno', type: 'button', title: 'Modelo, endereco (baseUrl) e comando nas configuracoes do VS Code', onclick: () => enviar({ tipo: 'agenteConfigurar', id: a.id }) }, 'Modelo e endereco') : null),
    painelLogin(a),
    h('label', { class: 'rotulo' }, 'Modo de permissao', modo),
    h('label', { class: 'rotulo' }, 'Papel', papel),
    a.temSessao ? h('button', { class: 'btn fantasma pequeno', type: 'button', title: 'Esquece o fio da conversa deste agente', onclick: () => enviar({ tipo: 'agenteNovaSessao', id: a.id }) }, 'Comecar sessao nova') : null);
}

// ---------- login sem terminal (v2) ----------
const conectado = (a: Agente) => a.login === 'conectado' || a.login === 'chave_configurada';
const EM_ANDAMENTO = new Set(['iniciando', 'aguardando_navegador', 'codigo_dispositivo', 'validando']);

function botaoLogin(a: Agente): HTMLElement | null {
  if (!a.instalado || !a.opcoesLogin.length) return null;
  if (conectado(a)) {
    return h('button', { class: 'btn fantasma pequeno', type: 'button', title: `Encerrar o login de ${a.nick}`, onclick: () => enviar({ tipo: 'logout', id: a.id }) }, 'Sair');
  }
  const aberto = loginAberto.has(a.id);
  return h('button', {
    class: `btn pequeno ${aberto ? '' : 'primario'}`, type: 'button', 'aria-expanded': aberto ? 'true' : 'false',
    onclick: () => { if (aberto) loginAberto.delete(a.id); else loginAberto.add(a.id); renderTudo(); },
  }, aberto ? 'Fechar' : 'Entrar');
}

function campos(a: Agente): { chave: HTMLInputElement; baseUrl: HTMLInputElement } {
  let c = camposChave.get(a.id);
  if (!c) {
    c = {
      chave: h('input', { class: 'campo', type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: 'Cole a chave aqui', 'aria-label': `Chave de API de ${a.nick}` }),
      baseUrl: h('input', { class: 'campo', type: 'url', placeholder: 'https://servidor/v1', 'aria-label': `Endereco da API de ${a.nick}` }),
    };
    camposChave.set(a.id, c);
  }
  return c;
}

function formularioChave(a: Agente, o: OpcaoLogin): HTMLElement {
  const c = campos(a);
  const pedeEndereco = o.variante === 'com_baseUrl';
  const btn = h('button', { class: 'btn primario', type: 'button' }, 'Validar e salvar');
  const atualizar = () => { btn.disabled = c.chave.value.trim().length < 8 || (pedeEndereco && !/^https?:\/\//i.test(c.baseUrl.value.trim())); };
  c.chave.oninput = atualizar;
  c.baseUrl.oninput = atualizar;
  atualizar();
  btn.onclick = () => {
    const chave = c.chave.value.trim();
    c.chave.value = ''; // a chave nao permanece no DOM depois de enviada
    progressos.set(a.id, { agente: a.id, etapa: 'validando' });
    enviar({ tipo: 'loginChave', id: a.id, chave, baseUrl: pedeEndereco ? c.baseUrl.value.trim() : undefined });
    renderTudo();
  };
  c.chave.onkeydown = (e) => { if (e.key === 'Enter' && !btn.disabled) btn.click(); };
  return h('div', { class: 'login-chave' },
    h('div', { class: 'linha' },
      h('strong', {}, o.rotulo),
      o.linkChave ? h('button', { class: 'btn fantasma pequeno', type: 'button', title: o.linkChave, onclick: () => enviar({ tipo: 'abrirLinkLogin', url: o.linkChave! }) }, 'Criar chave no site oficial ', icone('exportar')) : null),
    pedeEndereco ? h('label', { class: 'rotulo' }, 'Endereco da API', c.baseUrl) : null,
    h('label', { class: 'rotulo' }, 'Chave de API', c.chave),
    h('div', { class: 'linha' }, btn, h('span', { class: 'nota' }, 'A chave e testada no provedor antes de ser guardada no cofre do VS Code.')),
    o.ajuda ? h('p', { class: 'nota' }, o.ajuda) : null);
}

function painelProgresso(a: Agente, p: ProgressoLogin): HTMLElement {
  const cancelar = h('button', { class: 'btn pequeno', type: 'button', onclick: () => enviar({ tipo: 'loginCancelar', id: a.id }) }, 'Cancelar');
  const abrir = (rotulo: string, primario = false) => p.url
    ? h('button', { class: `btn pequeno ${primario ? 'primario' : ''}`, type: 'button', title: p.url, onclick: () => enviar({ tipo: 'abrirLinkLogin', url: p.url! }) }, rotulo)
    : null;
  switch (p.etapa) {
    case 'codigo_dispositivo': {
      const copiar = h('button', { class: 'bi', type: 'button', title: 'Copiar codigo', 'aria-label': 'Copiar codigo' }, icone('copiar'));
      copiar.onclick = () => void navigator.clipboard.writeText(p.codigo ?? '').then(() => copiar.classList.add('ok'));
      return h('div', { class: 'login-progresso', role: 'status' },
        h('p', {}, 'Abra a pagina de login e informe este codigo:'),
        h('div', { class: 'codigo-dispositivo' }, h('code', {}, p.codigo ?? ''), copiar),
        h('div', { class: 'linha' }, abrir('Abrir pagina de login', true), cancelar),
        h('p', { class: 'nota' }, 'Esta tela atualiza sozinha quando o login terminar.'));
    }
    case 'aguardando_navegador':
      return h('div', { class: 'login-progresso', role: 'status' },
        h('p', {}, h('span', { class: 'girando', 'aria-hidden': 'true' }), ' Conclua o login na janela do navegador.'),
        h('div', { class: 'linha' }, abrir('Abrir o link de novo'), cancelar),
        h('p', { class: 'nota' }, 'Esta tela atualiza sozinha quando o login terminar.'));
    case 'erro':
      return h('div', { class: 'login-progresso erro', role: 'alert' },
        h('p', {}, p.mensagem ?? 'Nao foi possivel entrar.'),
        h('button', { class: 'btn pequeno', type: 'button', onclick: () => { progressos.delete(a.id); renderTudo(); } }, 'Tentar de novo'));
    default:
      return h('div', { class: 'login-progresso', role: 'status' },
        h('p', {}, h('span', { class: 'girando', 'aria-hidden': 'true' }), ' ', p.mensagem ?? (p.etapa === 'validando' ? 'Validando a chave com o provedor...' : 'Iniciando o login...')),
        p.etapa === 'validando' ? null : h('div', { class: 'linha' }, cancelar));
  }
}

function painelLogin(a: Agente): HTMLElement | null {
  if (!a.instalado) return null;
  if (!a.opcoesLogin.length) {
    return a.login === 'desconectado' ? h('p', { class: 'nota' }, 'Servico local nao respondeu. Verifique se ele esta em execucao.') : null;
  }
  const p = progressos.get(a.id);
  const andamento = !!p && EM_ANDAMENTO.has(p.etapa);
  if (conectado(a) && !andamento) return a.conta ? h('p', { class: 'nota conta' }, `Conectado: ${a.conta}`) : null;
  if (p && p.etapa === 'erro') return h('div', { class: 'login' }, painelProgresso(a, p));
  if (andamento) return h('div', { class: 'login' }, painelProgresso(a, p!));
  if (!loginAberto.has(a.id)) return null;
  const remotos = a.opcoesLogin.filter((o) => o.metodo !== 'chave');
  const chaves = a.opcoesLogin.filter((o) => o.metodo === 'chave');
  return h('div', { class: 'login' },
    remotos.length ? h('div', { class: 'login-opcoes' }, ...remotos.map((o) => h('div', { class: 'login-opcao' },
      h('button', {
        class: 'btn primario', type: 'button',
        onclick: () => {
          progressos.set(a.id, { agente: a.id, etapa: 'iniciando' });
          enviar({ tipo: 'loginIniciar', id: a.id, metodo: o.metodo, variante: o.variante });
          renderTudo();
        },
      }, o.metodo === 'dispositivo' ? o.rotulo : `Entrar com ${o.rotulo}`),
      o.ajuda ? h('span', { class: 'nota' }, o.ajuda) : null))) : null,
    remotos.length && chaves.length ? h('div', { class: 'separador' }, 'ou') : null,
    ...chaves.map((o) => formularioChave(a, o)));
}

function vistaAgentes(): HTMLElement {
  return h('div', { class: 'pagina' },
    h('div', { class: 'pagina-topo' }, botaoIcone('voltar', 'Voltar ao chat', () => irPara('chat')), h('h2', {}, 'Agentes')),
    h('p', { class: 'nota' }, 'Habilite, faca login e defina o papel e a permissao de cada agente. Todos os habilitados participam da mesma sala.'),
    ...(E?.agentes ?? []).map(cartaoAgente),
    h('button', { class: 'btn', type: 'button', onclick: () => enviar({ tipo: 'instalarAgente' }) }, icone('mais'), ' Instalar outro agente'));
}

function seletorNivel(atual: NivelPermissao, aoEscolher: (n: NivelPermissao, confirmacao?: string) => void): HTMLElement {
  const confirmacao = h('input', { class: 'campo', type: 'text', placeholder: CONFIRMACAO_NIVEL_TOTAL, 'aria-label': `Digite ${CONFIRMACAO_NIVEL_TOTAL} para confirmar` });
  const btnTotal = h('button', { class: 'btn perigo', type: 'button', disabled: true }, 'Ativar acesso total');
  confirmacao.addEventListener('input', () => { btnTotal.disabled = confirmacao.value.trim() !== CONFIRMACAO_NIVEL_TOTAL; });
  btnTotal.addEventListener('click', () => aoEscolher('total', confirmacao.value.trim()));
  const avisoTotal = h('div', { class: 'aviso-total', hidden: true, role: 'region', 'aria-label': 'Riscos do acesso total' },
    h('h3', {}, 'Riscos do acesso total'),
    h('ul', {}, ...RISCOS_TOTAL.map((r) => h('li', {}, r))),
    h('p', {}, 'Para ativar, digite ', h('code', {}, CONFIRMACAO_NIVEL_TOTAL), ':'),
    confirmacao, btnTotal);
  const cartoes = (Object.keys(NIVEIS) as NivelPermissao[]).map((n) => h('button', {
    class: `nivel-cartao n-${n} ${n === atual ? 'sel' : ''}`, type: 'button', 'aria-pressed': n === atual ? 'true' : 'false',
    onclick: () => {
      if (n === 'total') { avisoTotal.hidden = false; confirmacao.focus(); return; }
      avisoTotal.hidden = true; aoEscolher(n);
    },
  }, h('strong', {}, NIVEIS[n].titulo), h('span', { class: 'resumo' }, NIVEIS[n].resumo), h('ul', {}, ...NIVEIS[n].itens.map((i) => h('li', {}, i)))));
  return h('div', { class: 'niveis' }, ...cartoes, avisoTotal);
}

function campoNumero(rotulo: string, valor: number, min: number, max: number, aoMudar: (n: number) => void): HTMLElement {
  const inp = h('input', { class: 'campo', type: 'number', min, max, value: valor });
  inp.addEventListener('change', () => { const n = Math.min(max, Math.max(min, Number(inp.value) || min)); inp.value = String(n); aoMudar(n); });
  return h('label', { class: 'rotulo' }, rotulo, inp);
}
function campoTexto(rotulo: string, valor: string, aoMudar: (s: string) => void): HTMLElement {
  const inp = h('input', { class: 'campo', type: 'text', value: valor });
  inp.addEventListener('change', () => aoMudar(inp.value.trim()));
  return h('label', { class: 'rotulo' }, rotulo, inp);
}

function vistaConfig(): HTMLElement {
  const c = E!.configuracao;
  const l = c.limites;
  const lim = (k: keyof typeof l) => (n: number) => enviar({ tipo: 'configurar', parcial: { limites: { ...E!.configuracao.limites, [k]: n } } });
  return h('div', { class: 'pagina' },
    h('div', { class: 'pagina-topo' }, botaoIcone('voltar', 'Voltar ao chat', () => irPara('chat')), h('h2', {}, 'Configuracoes')),
    h('h3', {}, 'Nivel de permissao'),
    seletorNivel(c.nivel, (n, conf) => enviar({ tipo: 'definirNivel', nivel: n, confirmacao: conf })),
    h('h3', {}, 'Sala'),
    campoTexto('Seu apelido', c.nick, (s) => s && enviar({ tipo: 'configurar', parcial: { nick: s } })),
    campoTexto('Topico', c.topico, (s) => enviar({ tipo: 'configurar', parcial: { topico: s } })),
    campoNumero('Passagens automaticas entre agentes (0 desliga)', c.passagensAutomaticas, 0, 20, (n) => enviar({ tipo: 'configurar', parcial: { passagensAutomaticas: n } })),
    campoNumero('Tempo maximo por resposta (minutos)', c.timeoutMinutos, 1, 120, (n) => enviar({ tipo: 'configurar', parcial: { timeoutMinutos: n } })),
    h('h3', {}, 'Limites de anexos'),
    h('p', { class: 'nota' }, 'Planilhas nunca sao lidas por inteiro: o Orquestrador envia so cabecalho e amostra de linhas.'),
    h('div', { class: 'grade' },
      campoNumero('Planilha: tamanho maximo (MB)', l.planilhaMaxMB, 1, 5, lim('planilhaMaxMB')),
      campoNumero('Planilha: linhas por aba', l.planilhaLinhasPorAba, 5, 200, lim('planilhaLinhasPorAba')),
      campoNumero('Planilha: abas', l.planilhaAbas, 1, 10, lim('planilhaAbas')),
      campoNumero('Texto integral ate (KB)', l.textoIntegralKB, 16, 512, lim('textoIntegralKB')),
      campoNumero('Texto: tamanho maximo (MB)', l.textoMaxMB, 1, 2, lim('textoMaxMB')),
      campoNumero('Imagem: tamanho maximo (MB)', l.imagemMaxMB, 1, 10, lim('imagemMaxMB')),
      campoNumero('PDF/Word: tamanho maximo (MB)', l.documentoMaxMB, 1, 20, lim('documentoMaxMB'))),
    secaoVoz(),
    h('h3', {}, 'Dados'),
    h('p', { class: 'nota' }, 'Conversas, acoes e anexos ficam somente neste computador, em ~/.orquestra/dados. Nada e enviado sem seu pedido.'),
    h('button', { class: 'btn', type: 'button', onclick: () => enviar({ tipo: 'exportarConversa' }) }, icone('exportar'), ' Exportar esta conversa'));
}

// ---------- assistente da primeira execucao ----------
function vistaAssistente(): HTMLElement {
  const passos = ['Boas-vindas', 'Agentes', 'Permissoes', 'Pronto'];
  const navegar = (d: number) => { passoAssistente = Math.max(0, Math.min(passos.length - 1, passoAssistente + d)); renderTudo(); };
  let corpo: HTMLElement;
  if (passoAssistente === 0) {
    corpo = h('div', {},
      h('h2', {}, 'Bem-vindo ao Orquestrador Fagulha'),
      h('p', {}, 'Uma sala por janela do VS Code onde seus agentes de IA conversam entre si e com voce, compartilham o que leem e escrevem, e so agem dentro das permissoes que voce definir.'),
      h('ul', { class: 'lista-simples' },
        h('li', {}, 'Tudo fica gravado somente neste computador.'),
        h('li', {}, 'Nada e publicado ou enviado sem seu pedido.'),
        h('li', {}, 'Chaves de API ficam no cofre seguro do VS Code.')));
  } else if (passoAssistente === 1) {
    corpo = h('div', {}, h('h2', {}, 'Agentes encontrados'),
      h('p', { class: 'nota' }, 'Habilite os que vao participar e faca login. Voce pode mudar isso depois.'),
      ...(E?.agentes ?? []).map(cartaoAgente));
  } else if (passoAssistente === 2) {
    corpo = h('div', {}, h('h2', {}, 'Nivel de permissao'),
      h('p', { class: 'nota' }, 'Define quanto os agentes podem fazer sem esperar sua aprovacao.'),
      seletorNivel(E!.configuracao.nivel, (n, conf) => enviar({ tipo: 'definirNivel', nivel: n, confirmacao: conf })));
  } else {
    const ativos = E?.agentes.filter((a) => a.habilitado && a.instalado) ?? [];
    corpo = h('div', {}, h('h2', {}, 'Tudo pronto'),
      h('p', {}, `Nivel: ${NIVEIS[E!.configuracao.nivel].titulo}. Agentes: ${ativos.map((a) => a.nick).join(', ') || 'nenhum'}.`),
      h('p', { class: 'nota' }, 'Mencione um agente com @ para acionar.'));
  }
  return h('div', { class: 'pagina assistente' },
    h('ol', { class: 'passos' }, ...passos.map((p, i) => h('li', { class: i === passoAssistente ? 'atual' : i < passoAssistente ? 'feito' : '' }, p))),
    corpo,
    h('div', { class: 'botoes' },
      passoAssistente > 0 ? h('button', { class: 'btn', type: 'button', onclick: () => navegar(-1) }, 'Voltar') : null,
      passoAssistente < passos.length - 1
        ? h('button', { class: 'btn primario', type: 'button', onclick: () => navegar(1) }, 'Continuar')
        : h('button', { class: 'btn primario', type: 'button', onclick: () => enviar({ tipo: 'concluirAssistente' }) }, 'Abrir a sala')));
}

// ---------- montagem ----------
function renderTudo(): void {
  if (!E) return;
  const assistente = E.primeiraExecucao;
  const chat = !assistente && vista === 'chat';
  app.dataset.vista = assistente ? 'assistente' : vista;
  renderCabecalho(); renderFaixa(); renderAprovacoes(); renderChipsComposer(); renderVoz();
  [faixa, lista, composer].forEach((el) => { el.hidden = !chat; });
  cabecalho.hidden = assistente;
  vistaExtra.hidden = chat;
  if (assistente) vistaExtra.replaceChildren(vistaAssistente());
  else if (vista === 'agentes') vistaExtra.replaceChildren(vistaAgentes());
  else if (vista === 'config') vistaExtra.replaceChildren(vistaConfig());
  else vistaExtra.replaceChildren();
  if (chat) renderMensagens();
  ajustarAltura();
}

function substituir<T extends { id: string }>(lista: T[], item: T): T[] {
  const i = lista.findIndex((x) => x.id === item.id);
  if (i < 0) return [...lista, item];
  const nova = lista.slice(); nova[i] = item; return nova;
}

ouvir((m: DoHost) => {
  if (m.tipo === 'estado') {
    if (m.estado.versaoProtocolo !== VERSAO_PROTOCOLO) {
      app.replaceChildren(h('div', { class: 'msg erro' }, `Versao de protocolo incompativel (host ${m.estado.versaoProtocolo}, interface ${VERSAO_PROTOCOLO}). Recarregue a janela.`));
      return;
    }
    E = m.estado; cache.clear(); fimAnteriores = false; renderTudo(); return;
  }
  if (!E) return;
  switch (m.tipo) {
    case 'mensagem': E.mensagens = substituir(E.mensagens, m.mensagem); renderMensagensDepois(); break;
    case 'anteriores': E.mensagens = [...m.mensagens.filter((x) => !E!.mensagens.some((y) => y.id === x.id)), ...E.mensagens]; fimAnteriores = m.fim; renderMensagens(); break;
    case 'agente': E.agentes = substituir(E.agentes, m.agente); renderTudo(); break;
    case 'anexo': E.anexosPendentes = substituir(E.anexosPendentes, m.anexo); renderChipsComposer(); if (m.anexo.tratamento === 'recusado' && m.anexo.aviso) avisar(m.anexo.aviso); break;
    case 'anexoRemovido': E.anexosPendentes = E.anexosPendentes.filter((a) => a.id !== m.id); renderChipsComposer(); break;
    case 'contexto': E.contextos = substituir(E.contextos, m.contexto); renderChipsComposer(); break;
    case 'contextoRemovido': E.contextos = E.contextos.filter((c) => c.id !== m.id); renderChipsComposer(); break;
    case 'aprovacao': E.aprovacoes = substituir(E.aprovacoes, m.pedido); renderAprovacoes(); break;
    case 'aprovacaoResolvida': E.aprovacoes = E.aprovacoes.filter((p) => p.id !== m.id); renderAprovacoes(); break;
    case 'configuracao': E.configuracao = m.configuracao; renderTudo(); break;
    case 'estadoVoz': {
      const falandoAntes = E.voz.leitura.falando;
      E.voz = m.voz;
      for (const c of m.voz.componentes) if (c.situacao !== 'instalando') progressoVoz.delete(c.componente);
      if (falandoAntes !== m.voz.leitura.falando) renderMensagensDepois();
      if (vista === 'config') renderTudo(); else renderVoz();
      break;
    }
    case 'vozInstalacao':
      progressoVoz.set(m.progresso.componente, m.progresso);
      if (m.progresso.etapa === 'erro' && m.progresso.mensagem) avisar(m.progresso.mensagem);
      if (vista === 'config') renderTudo();
      break;
    case 'voz':
      E.voz = { ...E.voz, gravando: m.gravando };
      if (m.transcricao) { texto.value = `${texto.value}${texto.value && !texto.value.endsWith(' ') ? ' ' : ''}${m.transcricao}`; ajustarAltura(); texto.focus(); salvarLocal({ rascunho: texto.value }); }
      if (m.erro) avisar(m.erro);
      renderVoz(); break;
    case 'aviso': avisar(m.texto); break;
    case 'login': {
      const p = m.progresso;
      progressos.set(p.agente, p);
      if (p.etapa === 'conectado' || p.etapa === 'cancelado') {
        loginAberto.delete(p.agente); progressos.delete(p.agente);
        if (p.etapa === 'conectado') { camposChave.delete(p.agente); avisar(`${E.agentes.find((a) => a.id === p.agente)?.nick ?? p.agente} conectado${p.conta ? `: ${p.conta}` : ''}.`); }
      }
      renderTudo(); break;
    }
  }
});

app.append(h('div', { class: 'soltar', 'aria-hidden': 'true' }, icone('clipe'), 'Solte para anexar'));
enviar({ tipo: 'pronto' });
