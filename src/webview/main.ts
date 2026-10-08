/// <reference lib="dom" />
// Interface de chat do Orquestrador Fagulha (webview). Dono: Claude.
// Fala com o host somente pelos tipos de src/shared/protocolo.ts.
import {
  CONFIRMACAO_NIVEL_TOTAL, VERSAO_PROTOCOLO,
  type Agente, type ComponenteVoz, type DoHost, type EstadoVoz, type ItemInstalacaoVoz, type Memoria, type ModeloVoz, type OpcaoLogin, type ProgressoInstalacaoVoz, type ProgressoLogin, type EstadoSala, type Mensagem, type ModoAgente, type NivelPermissao, type PedidoAprovacao, type ResumoChat,
  type MotorLeitura, type PerguntaAgente, type TipoFase,
} from '../shared/protocolo';
import { renderMarkdown } from './markdown';
import { botaoIcone, bytes, enviar, h, hora, icone, local, ouvir, salvarLocal, type Vista } from './util';
import { localeIntl, t } from './i18n';
import { abrirIntegracoes, iniciarIntegracoes, receberIntegracao, receberIntegracoes, receberSkill, receberSkills, vistaIntegracoes } from './integracoes';
const traduzir = t;

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
    titulo: t('Manual'),
    resumo: t('You approve 100% of agent actions.'),
    itens: [t('Every read, write, command and network access asks for your approval.'), t('Agents work in read-only mode and ask for each change.')],
  },
  parcial: {
    titulo: t('Partial'),
    resumo: t('Free inside the project; approval for everything else.'),
    itens: [t('Reading and writing inside the project folder follow each agent mode.'), t('Ask for approval: files outside the project, commands, external browser and external systems.')],
  },
  total: {
    titulo: t('Full'),
    resumo: t('Complete access to the computer, with notice of every action.'),
    itens: [t('Agents act without waiting and report their actions in the room.'), t('Known irreversible external commands ask for confirmation. Codex: network, web search and user MCP servers enabled.'), t('Direct calls to user MCP servers do not go through room confirmation.')],
  },
};
const RISCOS_TOTAL = [
  t('Agents will be able to read, create, change and run programs in any folder of the computer, not only in the project.'),
  t('An agent mistake or a malicious instruction from a file or web page can change or expose data before you notice.'),
  t('Files with secrets (.env, keys, local databases) are within reach of the agents; Orquestrador blocks the known ones, but not all.'),
  t('Known irreversible external commands ask for confirmation; other actions run automatically. Inherited MCP servers and native edits do not go through the approval gate.'),
];
const MODOS: Record<ModoAgente, string> = { leitura_escrita: t('Read and write'), leitura: t('Read only'), escrita: t('Write only') };
const CATEGORIAS: Record<string, string> = {
  irreversivel_externo: t('Irreversible external action'),
  leitura_workspace: t('Read in project'), escrita_workspace: t('Write in project'), leitura_maquina: t('Read outside project'),
  escrita_maquina: t('Write outside project'), comando: t('Run command'), rede_leitura: t('Access the web'), navegador: t('External browser'),
  externo: t('External system'), publicacao: t('Publish or send'), credencial: t('Use credential'), destrutiva: t('Destructive action'), memoria: t('Save to memory'),
};
const LOGIN: Record<string, string> = { conectado: t('connected'), chave_configurada: t('key configured'), desconectado: t('disconnected'), desconhecido: t('unknown sign-in') };
const ESTADOS: Record<string, string> = { livre: t('idle'), na_fila: t('queued'), trabalhando: t('working'), desabilitado: t('disabled'), erro: t('error') };

// ---------- estrutura fixa ----------
const cabecalho = h('header', { class: 'cab' });
const faixa = h('nav', { class: 'faixa', 'aria-label': t('Agents in the room') });
const painelAprov = h('section', { class: 'aprovacoes', 'aria-live': 'assertive' });
const lista = h('main', { class: 'lista', 'aria-live': 'polite' });
const composer = h('footer', { class: 'composer' });
const vistaExtra = h('section', { class: 'vista' });

// ---------- cabecalho ----------
function renderCabecalho(): void {
  if (!E) return;
  const trabalhando = E.agentes.some((a) => a.estado === 'trabalhando');
  cabecalho.replaceChildren(
    h('div', { class: 'titulo' },
      h('span', { class: 'canal', title: 'Orquestrador Fagulha' }, '#fagulha_orquestrador'),
      h('span', { class: 'projeto', title: `${E.chat.titulo}\n${E.chat.projeto ?? t('No project')}` }, E.chat.titulo)),
    h('div', { class: 'acoes' },
      trabalhando ? botaoIcone('parar', t('Stop the current agent'), () => enviar({ tipo: 'parar' }), 'perigo') : null,
      h('span', { class: `nivel n-${E.configuracao.nivel}`, title: t('Permission level: {level}', { level: NIVEIS[E.configuracao.nivel].titulo }) },
        icone('escudo'), NIVEIS[E.configuracao.nivel].titulo),
      btnLeitura,
      botaoIcone('mais', t('New chat'), () => { enviar({ tipo: 'novoChat' }); irPara('chat'); }),
      botaoIcone('chats', t('Chats and memory'), () => (vista === 'chats' ? irPara('chat') : abrirChats()), vista === 'chats' ? 'ativo' : ''),
      botaoIcone('plug', E.integracoesConectadas ? t('Integrations and skills ({n} connected)', { n: E.integracoesConectadas }) : t('Integrations and skills'), () => {
        if (vista === 'integracoes') return irPara('chat');
        abrirIntegracoes();
        irPara('integracoes');
      }, vista === 'integracoes' ? 'ativo' : ''),
      botaoIcone('pessoas', t('Agents'), () => irPara(vista === 'agentes' ? 'chat' : 'agentes'), vista === 'agentes' ? 'ativo' : ''),
      botaoIcone('engrenagem', t('Settings'), () => irPara(vista === 'config' ? 'chat' : 'config'), vista === 'config' ? 'ativo' : '')),
  );
}

// ---------- faixa de agentes ----------
function chipAgente(a: Agente): HTMLElement {
  const desc = !a.instalado ? t('not installed') : !a.habilitado ? t('disabled') : `${ESTADOS[a.estado] ?? a.estado} - ${LOGIN[a.login]} - ${MODOS[a.modo]}`;
  return h('button', {
    class: `chip ag c-${a.cor} e-${a.habilitado && a.instalado ? a.estado : 'desabilitado'}`, type: 'button',
    title: `${a.nick}: ${desc}${a.papel ? `\n${t('Role')}: ${a.papel}` : ''}\n${t('Click to mention')}`,
    onclick: () => mencionar(a.nick),
  }, h('span', { class: 'ponto' }), a.nick, a.login === 'desconectado' ? h('span', { class: 'alerta' }, '!') : null);
}
function renderFaixa(): void {
  if (!E) return;
  const ativos = E.agentes.filter((a) => a.instalado && a.habilitado);
  faixa.replaceChildren(
    ...ativos.map(chipAgente),
    ...(ativos.length ? [] : [h('span', { class: 'vazio' }, t('No agents enabled.'))]),
    h('button', { class: 'chip mais', type: 'button', title: t('Manage agents'), onclick: () => irPara('agentes') }, icone('mais')),
  );
}

// ---------- aprovacoes ----------
function cartaoAprovacao(p: PedidoAprovacao): HTMLElement {
  const agente = E?.agentes.find((a) => a.id === p.agente);
  const responder = (decisao: 'aprovar' | 'aprovar_sessao' | 'negar') => enviar({ tipo: 'responderAprovacao', id: p.id, decisao });
  return h('article', { class: `aprov ${p.critica ? 'critica' : ''}`, role: 'alertdialog', 'aria-label': t('Request from {agent}', { agent: agente?.nick ?? p.agente }) },
    h('div', { class: 'aprov-topo' },
      h('span', { class: `quem c-${agente?.cor ?? 'azul'}` }, agente?.nick ?? p.agente),
      h('span', { class: 'cat' }, CATEGORIAS[p.categoria] ?? p.categoria),
      p.critica ? h('span', { class: 'cat critica' }, t('critical')) : null,
      p.expiraEm ? h('span', { class: 'expira', 'data-expira': p.expiraEm }) : null),
    h('p', { class: 'resumo' }, p.resumo),
    p.detalhe ? h('pre', { class: 'detalhe' }, p.detalhe) : null,
    h('div', { class: 'botoes' },
      h('button', { class: 'btn primario', type: 'button', onclick: () => responder('aprovar') }, t('Approve')),
      p.critica ? null : h('button', { class: 'btn', type: 'button', title: t('Approves this type of action from this agent until the end of the session'), onclick: () => responder('aprovar_sessao') }, t('Approve for session')),
      h('button', { class: 'btn perigo', type: 'button', onclick: () => responder('negar') }, t('Deny'))));
}
function renderAprovacoes(): void {
  painelAprov.replaceChildren(...(E?.aprovacoes ?? []).map(cartaoAprovacao));
  painelAprov.hidden = !E?.aprovacoes.length;
  atualizarContagens();
}
function atualizarContagens(): void {
  for (const el of Array.from(painelAprov.querySelectorAll<HTMLElement>('.expira'))) {
    const s = Math.max(0, Math.round((Date.parse(el.dataset.expira ?? '') - Date.now()) / 1000));
    el.textContent = s > 0 ? t('denies in {s}s', { s }) : t('expiring');
  }
}
setInterval(atualizarContagens, 1000);

// ---------- mensagens ----------
const cache = new Map<string, { chave: string; el: HTMLElement }>();
let fimAnteriores = false;
const execucoesAbertas = new Set<string>();

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

// Toda sequencia de acoes fica em uma linha, sem interromper a ordem das falas.
function renderMensagens(): void {
  if (!E) return;
  const perto = lista.scrollHeight - lista.scrollTop - lista.clientHeight < 80;
  const filhos: HTMLElement[] = [];
  if (!fimAnteriores && E.mensagens.length) {
    filhos.push(h('button', { class: 'btn fantasma anteriores', type: 'button', onclick: () => enviar({ tipo: 'carregarAnteriores', antesDe: E!.mensagens[0].id }) }, t('Load earlier messages')));
  }
  const ms = E.mensagens;
  for (let i = 0; i < ms.length; i++) {
    if (ms[i].tipo === 'acao') {
      let j = i;
      while (j + 1 < ms.length && ms[j + 1].tipo === 'acao' && ms[j + 1].autor === ms[i].autor) j++;
      const grupo = ms.slice(i, j + 1);
      {
        const id = ms[i].id;
        const ultima = grupo.at(-1)!;
        const resumo = ultima.texto.split(/\r?\n/, 1)[0].replace(/\s+/g, ' ').trim().slice(0, 180);
        const det = h('details', { class: 'grupo-acoes' },
          h('summary', { title: t('Click or press Enter to show or hide execution details') },
            h('time', { datetime: ultima.quando }, hora(ultima.quando)),
            h('span', { class: 'execucao-autor' }, ms[i].autor),
            h('span', { class: 'execucao-contagem' }, grupo.length === 1 ? t('1 action') : t('{n} actions', { n: grupo.length })),
            h('span', { class: 'ultima' }, resumo)),
          h('div', { class: 'execucao-detalhes' }, ...grupo.map(elMensagem)));
        det.open = execucoesAbertas.has(id);
        det.addEventListener('toggle', () => {
          // Eventos enfileirados de elementos substituidos nao alteram o estado.
          if (!det.isConnected) return;
          if (det.open) execucoesAbertas.add(id);
          else execucoesAbertas.delete(id);
        });
        filhos.push(det);
        i = j;
        continue;
      }
    }
    filhos.push(elMensagem(ms[i]));
  }
  if (!E.chat.desteProjeto) {
    filhos.unshift(h('div', { class: 'aviso-chat', role: 'note' },
      t('This chat was created in {origin}. Agents work in the folder of this window ({folder}).', { origin: E.chat.projetoNome ?? t('a window without a project'), folder: E.sala.titulo })));
  }
  if (!ms.length) filhos.push(boasVindas());
  lista.replaceChildren(...filhos);
  if (perto) lista.scrollTop = lista.scrollHeight;
}

function boasVindas(): HTMLElement {
  const nomes = E?.agentes.filter((a) => a.habilitado && a.instalado).map((a) => `@${a.nick.toLowerCase()}`) ?? [];
  return h('div', { class: 'boas-vindas' },
    h('h2', {}, t('New chat')),
    h('p', {}, nomes.length ? t('Mention {names} or @todos to call agents. Without a mention, the message is only recorded.', { names: nomes.join(', ') }) : t('Enable an agent to start.')),
    E?.memoriasAtivas ? h('p', { class: 'nota' }, E.memoriasAtivas === 1 ? t('1 memory will be sent to the agents.') : t('{n} memories will be sent to the agents.', { n: E.memoriasAtivas })) : null,
    h('p', { class: 'nota' }, t('Previous conversations are in the Chats menu. Everything is stored only on this computer.')));
}

let agendado = false;
function renderMensagensDepois(): void {
  if (agendado) return;
  agendado = true;
  requestAnimationFrame(() => { agendado = false; renderMensagens(); });
}

// ---------- estagio do agente (v5) ----------
const faixaFases = h('div', { class: 'faixa-fases', role: 'status', 'aria-live': 'polite' });
const ROTULO_FASE: Record<TipoFase, string> = {
  pensando: t('Thinking'), lendo: t('Reading files'), pesquisando_web: t('Searching the web'), escrevendo: t('Writing'),
  executando: t('Running command'), aguardando_aprovacao: t('Waiting for your approval'), aguardando_resposta: t('Waiting for your answer'),
  respondendo: t('Answering'), concluido: t('finished'), interrompido: t('was stopped'), erro: t('ran into an error'),
};
const FINAIS = new Set<TipoFase>(['concluido', 'interrompido', 'erro']);
const finalVistoEm = new Map<string, number>();   // some com o tempo
const duracaoTexto = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ''}`;
};

function renderFases(): void {
  if (!E) return;
  const agora = Date.now();
  const linhas: HTMLElement[] = [];
  for (const a of E.agentes) {
    const f = a.fase;
    if (!f || !a.habilitado) continue;
    if (FINAIS.has(f.tipo)) {
      if (!finalVistoEm.has(a.id + f.desde)) finalVistoEm.set(a.id + f.desde, agora);
      if (agora - finalVistoEm.get(a.id + f.desde)! > 12000) continue;   // sinal final visivel por 12 s
      const icone = f.tipo === 'concluido' ? '✓' : f.tipo === 'interrompido' ? '■' : '⚠';
      linhas.push(h('div', { class: `fase final f-${f.tipo} c-${a.cor}` },
        h('span', { class: 'fase-icone', 'aria-hidden': 'true' }, icone),
        h('strong', {}, a.nick), ` ${ROTULO_FASE[f.tipo]}`,
        f.duracaoMs !== undefined ? h('span', { class: 'nota' }, ` ${t('in {time}', { time: duracaoTexto(f.duracaoMs) })}`) : null,
        f.tipo === 'erro' && f.detalhe ? h('span', { class: 'nota' }, ` — ${f.detalhe}`) : null));
      continue;
    }
    const espera = f.tipo === 'aguardando_aprovacao' || f.tipo === 'aguardando_resposta';
    linhas.push(h('div', { class: `fase c-${a.cor} ${espera ? 'espera' : ''}` },
      espera ? h('span', { class: 'fase-icone', 'aria-hidden': 'true' }, '?') : h('span', { class: 'girando', 'aria-hidden': 'true' }),
      h('strong', {}, a.nick), ` ${ROTULO_FASE[f.tipo]}`,
      f.detalhe ? h('span', { class: 'fase-detalhe', title: f.detalhe }, ` · ${f.detalhe}`) : null,
      h('span', { class: 'nota fase-tempo', 'data-desde': f.desde }, '')));
  }
  faixaFases.replaceChildren(...linhas);
  faixaFases.hidden = !linhas.length;
  atualizarTempos();
}
function atualizarTempos(): void {
  for (const el of Array.from(faixaFases.querySelectorAll<HTMLElement>('.fase-tempo'))) {
    const ms = Date.now() - Date.parse(el.dataset.desde ?? '');
    el.textContent = Number.isFinite(ms) ? ` · ${duracaoTexto(ms)}` : '';
  }
}
setInterval(() => { atualizarTempos(); if (E?.agentes.some((a) => a.fase && FINAIS.has(a.fase.tipo))) renderFases(); }, 1000);

// ---------- perguntas guiadas (v5) ----------
const painelPerguntas = h('section', { class: 'perguntas', 'aria-live': 'assertive' });
const rascunhoRespostas = new Map<string, Map<string, { opcoes: Set<string>; texto: string }>>();
// Atalhos: 1-6 escolhem a opcao da primeira pergunta sem resposta, Enter responde, Esc pula.
painelPerguntas.addEventListener('keydown', (e) => {
  const alvo = e.target as HTMLElement;
  if (alvo.tagName === 'INPUT') return;
  const cartao = painelPerguntas.querySelector<HTMLElement>('.cartao-pergunta');
  if (!cartao) return;
  if (/^[1-6]$/.test(e.key)) {
    const itens = Array.from(cartao.querySelectorAll<HTMLElement>('.pergunta-item'));
    const pendente = itens.find((f) => !f.querySelector('.opcao.sel')) ?? itens[0];
    const opcao = pendente?.querySelectorAll<HTMLButtonElement>('.opcao')[Number(e.key) - 1];
    if (opcao) { e.preventDefault(); opcao.click(); }
  } else if (e.key === 'Enter' && alvo.tagName !== 'BUTTON') {
    const btn = cartao.querySelector<HTMLButtonElement>('.botoes .btn.primario');
    if (btn && !btn.disabled) { e.preventDefault(); btn.click(); }
  } else if (e.key === 'Escape') {
    e.preventDefault();
    cartao.querySelector<HTMLButtonElement>('.botoes .btn:not(.primario)')?.click();
  }
});

function cartaoPergunta(p: PerguntaAgente): HTMLElement {
  const ag = E?.agentes.find((a) => a.id === p.agente);
  let rs = rascunhoRespostas.get(p.id);
  if (!rs) { rs = new Map(p.perguntas.map((q) => [q.id, { opcoes: new Set<string>(), texto: '' }])); rascunhoRespostas.set(p.id, rs); }
  const completo = () => p.perguntas.every((q) => { const r = rs!.get(q.id)!; return r.opcoes.size > 0 || r.texto.trim().length > 0; });
  const btnResponder = h('button', { class: 'btn primario', type: 'button' }, t('Answer'));
  const atualizarBotao = () => { btnResponder.disabled = !completo(); };
  btnResponder.addEventListener('click', () => {
    enviar({ tipo: 'responderPergunta', id: p.id, respostas: p.perguntas.map((q) => { const r = rs!.get(q.id)!; return { id: q.id, opcoes: [...r.opcoes], texto: r.texto.trim() || undefined }; }) });
    btnResponder.disabled = true; btnResponder.textContent = t('Sending...');
  });
  const blocos = p.perguntas.map((q, iq) => {
    const r = rs!.get(q.id)!;
    const opcoes = q.opcoes.map((o) => {
      const sel = r.opcoes.has(o.rotulo);
      const b = h('button', {
        class: `opcao ${sel ? 'sel' : ''} ${o.recomendada ? 'recomendada' : ''}`, type: 'button',
        role: q.multipla ? 'checkbox' : 'radio', 'aria-checked': sel ? 'true' : 'false',
      },
        h('span', { class: 'opcao-rotulo' }, o.rotulo, o.recomendada ? h('span', { class: 'tag' }, t('recommended')) : null),
        o.descricao ? h('span', { class: 'opcao-desc' }, o.descricao) : null);
      b.addEventListener('click', () => {
        if (q.multipla) { if (r.opcoes.has(o.rotulo)) r.opcoes.delete(o.rotulo); else r.opcoes.add(o.rotulo); }
        else { r.opcoes.clear(); r.opcoes.add(o.rotulo); r.texto = ''; }
        renderPerguntas();
      });
      return b;
    });
    const outra = q.permiteTexto ? (() => {
      const campoOutra = h('input', { class: 'campo', type: 'text', placeholder: t('Other answer (optional)'), value: r.texto, 'aria-label': t('Other answer for: {question}', { question: q.pergunta }) });
      campoOutra.addEventListener('input', () => { r.texto = campoOutra.value; if (!q.multipla && campoOutra.value.trim()) r.opcoes.clear(); atualizarBotao(); });
      campoOutra.addEventListener('change', () => renderPerguntas());
      return campoOutra;
    })() : null;
    return h('fieldset', { class: 'pergunta-item' },
      h('legend', {}, p.perguntas.length > 1 ? `${iq + 1}. ${q.pergunta}` : q.pergunta),
      q.multipla ? h('span', { class: 'nota' }, t('You can select more than one.')) : null,
      h('div', { class: 'opcoes', role: q.multipla ? 'group' : 'radiogroup' }, ...opcoes),
      outra);
  });
  atualizarBotao();
  return h('article', { class: `cartao-pergunta c-${ag?.cor ?? 'azul'}`, role: 'dialog', 'aria-label': t('Question from {agent}', { agent: ag?.nick ?? p.agente }) },
    h('div', { class: 'aprov-topo' },
      h('span', { class: 'quem' }, ag?.nick ?? p.agente),
      h('span', { class: 'cat' }, t('needs your answer')),
      h('span', { class: 'nota atalhos' }, t('1-6 choose · Enter answer · Esc skip')),
      p.expiraEm ? h('span', { class: 'expira', 'data-expira': p.expiraEm }) : null),
    p.titulo ? h('h3', { class: 'pergunta-titulo' }, p.titulo) : null,
    ...blocos,
    h('div', { class: 'botoes' }, btnResponder,
      h('button', { class: 'btn', type: 'button', onclick: () => enviar({ tipo: 'cancelarPergunta', id: p.id }) }, t('Skip'))));
}

function renderPerguntas(): void {
  const ps = E?.perguntas ?? [];
  const pendente = ps.length > 0;
  const estavaPendente = app.classList.contains('pergunta-pendente');
  app.classList.toggle('pergunta-pendente', pendente);
  texto.placeholder = pendente ? t('Answer the question above so the agent can continue.') : t('Message the room. Use @ to mention.');
  // preserva o foco do campo de texto durante a re-renderizacao
  const ativo = document.activeElement as HTMLInputElement | null;
  const rotuloFoco = ativo?.closest('.cartao-pergunta') ? ativo.getAttribute('aria-label') : null;
  painelPerguntas.replaceChildren(...ps.map(cartaoPergunta));
  painelPerguntas.hidden = !ps.length;
  if (rotuloFoco) painelPerguntas.querySelector<HTMLInputElement>(`[aria-label="${CSS.escape(rotuloFoco)}"]`)?.focus();
  else if (pendente && !estavaPendente) painelPerguntas.querySelector<HTMLElement>('.opcao')?.focus();
}

// ---------- motor de leitura (v5) ----------
const chaveNuvem = h('input', { class: 'campo', type: 'password', autocomplete: 'off', placeholder: t('Paste the key here'), 'aria-label': t('Voice provider key') });
function blocoMotorLeitura(v: EstadoVoz): HTMLElement {
  const l = v.leitura;
  const NOMES: Record<MotorLeitura, string> = { sistema: t('System voice'), piper: t('Local neural (Piper) — natural, offline'), nuvem: t('Cloud (OpenAI or ElevenLabs) — more expressive') };
  const motor = h('select', { class: 'campo', 'aria-label': t('Voice engine') },
    ...l.motores.map((m) => h('option', { value: m.id, selected: m.id === l.motor, disabled: !m.disponivel }, `${NOMES[m.id]}${m.disponivel ? '' : ` (${m.motivo ?? t('unavailable')})`}`)));
  motor.addEventListener('change', () => enviar({ tipo: 'leituraConfigurar', motor: motor.value as MotorLeitura }));
  const variacao = h('input', { type: 'range', min: 0, max: 1, step: 0.1, value: l.variacao, 'aria-label': t('Intonation variation') });
  variacao.addEventListener('change', () => enviar({ tipo: 'leituraConfigurar', variacao: Number(variacao.value) }));
  const provedor = h('select', { class: 'campo', 'aria-label': t('Cloud voice provider') },
    h('option', { value: 'openai', selected: l.nuvem.provedor !== 'elevenlabs' }, 'OpenAI'),
    h('option', { value: 'elevenlabs', selected: l.nuvem.provedor === 'elevenlabs' }, 'ElevenLabs'));
  const salvarChave = h('button', { class: 'btn pequeno primario', type: 'button' }, t('Validate and save'));
  salvarChave.addEventListener('click', () => {
    const chave = chaveNuvem.value.trim();
    if (chave.length < 8) return;
    chaveNuvem.value = '';
    enviar({ tipo: 'leituraNuvemChave', provedor: provedor.value as 'openai' | 'elevenlabs', chave });
  });
  return h('div', { class: 'pilha' },
    h('label', { class: 'rotulo' }, t('Voice engine'), motor),
    l.motor !== 'sistema' ? h('label', { class: 'rotulo' }, t('Personality (intonation variation)'), variacao) : null,
    h('details', { class: 'nuvem-voz', open: l.motor === 'nuvem' && !l.nuvem.chaveConfigurada },
      h('summary', {}, t('Cloud voice (optional)')),
      h('p', { class: 'nota aviso-privacidade' }, t('Note: with cloud voice, the text read aloud (agent questions, announcements and summaries) is sent to the chosen provider. Everything else stays only on your computer.')),
      l.nuvem.chaveConfigurada
        ? h('div', { class: 'linha' }, h('span', { class: 'estado bom' }, t('{provider} key configured', { provider: l.nuvem.provedor === 'elevenlabs' ? 'ElevenLabs' : 'OpenAI' })),
          h('button', { class: 'btn fantasma pequeno', type: 'button', onclick: () => enviar({ tipo: 'leituraNuvemRemover' }) }, t('Remove')))
        : h('div', { class: 'pilha' }, h('label', { class: 'rotulo' }, t('Provider'), provedor), h('label', { class: 'rotulo' }, t('API key'), chaveNuvem), salvarChave)),
    h('p', { class: 'nota' }, t('Automatic reading speaks only agent questions, the announcement before acting and the summary when done.')));
}

app.append(cabecalho, faixa, faixaFases, painelAprov, lista, composer, vistaExtra);

// ---------- composer ----------
const chipsComposer = h('div', { class: 'chips-composer' });
const texto = h('textarea', { class: 'entrada', rows: 1, placeholder: t('Message the room. Use @ to mention.'), 'aria-label': t('Message') });
const sugestoes = h('ul', { class: 'sugestoes', role: 'listbox', hidden: true });
const barraGravacao = h('div', { class: 'barra-gravacao', role: 'status', hidden: true });
const btnVoz = botaoIcone('mic', t('Speak (local transcription)'), () => alternarVoz());
const btnLeitura = botaoIcone('som', t('Automatic reading of answers'), () => { if (E) enviar({ tipo: 'leituraConfigurar', ativa: !E.voz.leitura.ativa }); });
const btnEnviar = h('button', { class: 'bi enviar', type: 'button', title: t('Send (Enter)'), 'aria-label': t('Send'), onclick: () => enviarMensagem() }, icone('enviar'));
const avisoLocal = h('div', { class: 'aviso-local', role: 'status', hidden: true });
composer.append(
  painelPerguntas, avisoLocal, barraGravacao, chipsComposer,
  h('div', { class: 'caixa' }, sugestoes, texto),
  h('div', { class: 'barra' },
    botaoIcone('clipe', t('Attach files'), () => enviar({ tipo: 'anexarArquivos' })),
    botaoIcone('contexto', t('Add context from another chat'), () => enviar({ tipo: 'importarContexto' })),
    btnVoz,
    h('span', { class: 'dica' }, t('Enter sends, Shift+Enter adds a line')),
    btnEnviar));
texto.value = local().rascunho;

const TRATAMENTO: Record<string, string> = { amostra: t('sample'), metadados: t('metadata only'), recusado: t('rejected') };
function ajustarAltura(): void { texto.style.height = 'auto'; texto.style.height = `${Math.min(texto.scrollHeight, 220)}px`; }
function renderChipsComposer(): void {
  if (!E) return;
  const ctx = E.contextos.map((c) => h('span', { class: 'chip ctx', title: `${c.origem} - ${t('{n} characters', { n: c.caracteres.toLocaleString(localeIntl) })}` },
    icone('contexto'), c.titulo, h('button', { class: 'x', type: 'button', 'aria-label': t('Remove context {title}', { title: c.titulo }), onclick: () => enviar({ tipo: 'removerContexto', id: c.id }) }, icone('fechar'))));
  const anx = E.anexosPendentes.map((a) => h('span', { class: `chip anexo t-${a.tratamento}`, title: a.aviso ?? `${a.tipo} - ${bytes(a.bytes)}` },
    a.miniatura ? h('img', { src: a.miniatura, alt: '' }) : icone('clipe'),
    h('span', { class: 'nome' }, a.nome),
    h('span', { class: 'meta' }, a.tratamento === 'integral' ? bytes(a.bytes) : (TRATAMENTO[a.tratamento] ?? a.tratamento)),
    h('button', { class: 'x', type: 'button', 'aria-label': t('Remove {name}', { name: a.nome }), onclick: () => enviar({ tipo: 'removerAnexo', id: a.id }) }, icone('fechar'))));
  chipsComposer.replaceChildren(...ctx, ...anx);
  chipsComposer.hidden = !ctx.length && !anx.length;
}

function enviarMensagem(): void {
  const msg = texto.value.trim();
  const anexos = (E?.anexosPendentes ?? []).filter((a) => a.tratamento !== 'recusado').map((a) => a.id);
  if (!msg && !anexos.length) return;
  if (E?.perguntas.length) { avisar(t('A question is pending above. Answer or skip it so the agent can continue.')); return; }
  if (!anexos.length && comandoMemoria(msg)) { texto.value = ''; salvarLocal({ rascunho: '' }); ajustarAltura(); fecharSugestoes(); return; }
  enviar({ tipo: 'enviar', texto: msg, anexos });
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
  ops.push({ valor: 'todos', rotulo: `todos - ${t('calls all agents')}`, chaves: ['todos'] });
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
function limiteBytes(nome: string, tam: number): { max: number; rotulo: string; planilha?: boolean } {
  const l = E!.configuracao.limites;
  if (EXT_PLANILHA.test(nome) || (/\.csv$/i.test(nome) && tam > l.textoIntegralKB * 1024)) return { max: l.planilhaMaxMB, rotulo: t('spreadsheet'), planilha: true };
  if (EXT_IMAGEM.test(nome)) return { max: l.imagemMaxMB, rotulo: t('image') };
  if (EXT_DOC.test(nome)) return { max: l.documentoMaxMB, rotulo: t('document') };
  return { max: l.textoMaxMB, rotulo: t('file') };
}
function avisar(t: string): void {
  avisoLocal.textContent = t; avisoLocal.hidden = false;
  clearTimeout((avisar as unknown as { t?: number }).t);
  (avisar as unknown as { t?: number }).t = window.setTimeout(() => { avisoLocal.hidden = true; }, 7000);
}
function anexarArquivo(f: File): void {
  if (!E) return;
  const nome = f.name || `pasted-${Date.now()}.${(f.type.split('/')[1] || 'bin').replace('jpeg', 'jpg')}`;
  const { max, rotulo, planilha } = limiteBytes(nome, f.size);
  if (f.size > max * 1024 * 1024) {
    avisar(`${t('{name} rejected: {kind} of {size} exceeds the {max} MB limit.', { name: nome, kind: rotulo, size: bytes(f.size), max })}${planilha ? ` ${t('Large spreadsheets are not processed; send an excerpt.')}` : ''}`);
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
  base: t('base (~150 MB, faster)'),
  small: t('small (~490 MB, recommended)'),
  medium: t('medium (~1.5 GB, more accurate and slower)'),
};
const minSeg = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function alternarVoz(): void {
  if (!E) return;
  if (E.voz.transcrevendo) return;
  if (!E.voz.disponivel) {
    avisar(E.voz.motivo ?? t('Voice is not set up yet.'));
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
  btnVoz.title = !v.disponivel ? t('Set up voice: {reason}', { reason: v.motivo ?? '' }) : v.transcrevendo ? t('Transcribing...') : v.gravando ? t('Stop and transcribe') : t('Speak (local transcription)');
  btnVoz.setAttribute('aria-pressed', v.gravando ? 'true' : 'false');
  if (v.gravando || v.transcrevendo) {
    const seg = v.segundosGravados ?? 0;
    barraGravacao.replaceChildren(
      v.transcrevendo
        ? h('span', {}, h('span', { class: 'girando', 'aria-hidden': 'true' }), ` ${t('Transcribing on your computer...')}`)
        : h('span', {}, h('span', { class: 'ponto-gravando', 'aria-hidden': 'true' }), ` ${t('Recording {time} / {limit}', { time: minSeg(seg), limit: minSeg(v.limiteSegundos) })}`),
      ...(v.gravando ? [h('span', { class: 'acoes-gravacao' },
        h('button', { class: 'btn pequeno primario', type: 'button', onclick: () => enviar({ tipo: 'vozParar' }) }, v.envioAutomatico ? t('Stop and send') : t('Stop and transcribe')),
        h('button', { class: 'btn pequeno', type: 'button', onclick: () => enviar({ tipo: 'vozDescartar' }) }, t('Discard')))] : []));
    barraGravacao.hidden = false;
  } else {
    barraGravacao.hidden = true;
  }
  btnLeitura.classList.toggle('ativo', v.leitura.ativa);
  btnLeitura.hidden = !v.leitura.disponivel;
  btnLeitura.title = v.leitura.ativa ? t('Automatic reading of answers: on') : t('Automatic reading of answers: off');
  btnLeitura.setAttribute('aria-pressed', v.leitura.ativa ? 'true' : 'false');
}

// Botao "ouvir" de cada fala de agente.
function botaoOuvir(m: Mensagem): HTMLElement | null {
  if (!E?.voz.leitura.disponivel || m.parcial) return null;
  const falando = E.voz.leitura.falando === m.id;
  return h('button', {
    class: `bi ouvir ${falando ? 'ativo' : ''}`, type: 'button',
    title: falando ? t('Stop reading') : t('Listen to this answer'), 'aria-label': falando ? t('Stop reading') : t('Listen to this answer'),
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
        h('span', { class: 'estado-comp' }, ({ instalado: t('installed'), ausente: t('not installed'), instalando: t('installing'), erro: t('error'), manual: t('manual install') })[c.situacao]),
        c.tamanhoBytes && c.situacao !== 'instalado' ? h('span', { class: 'nota' }, bytes(c.tamanhoBytes)) : null,
        c.origem && c.situacao !== 'instalado' ? h('span', { class: 'nota' }, t('from {source}', { source: c.origem })) : null),
      c.situacao === 'instalando' && p
        ? h('div', { class: 'progresso-voz' },
          h('progress', { max: 100, value: pct ?? 0, 'aria-label': t('Progress of {name}', { name: c.nome }) }),
          h('span', { class: 'nota' }, p.etapa === 'baixando' ? `${pct ?? 0}%${p.totalBytes ? ` ${t('of {size}', { size: bytes(p.totalBytes) })}` : ''}` : p.etapa === 'verificando' ? t('verifying integrity...') : p.etapa === 'extraindo' ? t('extracting...') : (p.mensagem ?? '')))
        : null,
      c.situacao === 'manual' && c.comandoManual
        ? h('div', { class: 'comando-manual' }, h('code', {}, c.comandoManual),
          botaoIcone('copiar', t('Copy command'), () => void navigator.clipboard.writeText(c.comandoManual!)))
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
  const velocidade = h('input', { type: 'range', min: 0.5, max: 2, step: 0.1, value: v.leitura.velocidade, 'aria-label': t('Reading speed') });
  const rotuloVel = h('span', { class: 'nota' }, `${v.leitura.velocidade.toFixed(1)}x`);
  velocidade.addEventListener('input', () => { rotuloVel.textContent = `${Number(velocidade.value).toFixed(1)}x`; });
  velocidade.addEventListener('change', () => enviar({ tipo: 'leituraConfigurar', velocidade: Number(velocidade.value) }));

  return h('section', { id: 'config-voz', class: 'secao-voz' },
    h('h3', {}, t('Voice')),
    h('p', { class: 'nota' }, t('Speech and audio are processed only on this computer. The recording is deleted right after transcription.')),
    h('h4', {}, t('Speak')),
    h('ul', { class: 'lista-comp' }, ...v.componentes.map(linhaComponente)),
    faltando.length && !instalando
      ? h('div', { class: 'consentimento' },
        h('p', {}, t(faltando.length === 1 ? 'To use voice, Orquestrador needs to download one component{total} from the official sources listed above. Files are stored in ~/.orquestra/voz without changing your system.' : 'To use voice, Orquestrador needs to download {n} components{total} from the official sources listed above. Files are stored in ~/.orquestra/voz without changing your system.', { n: faltando.length, total: total ? ` (${t('{size} in total', { size: bytes(total) })})` : '' })),
        h('button', { class: 'btn primario', type: 'button', onclick: () => enviar({ tipo: 'vozInstalar', componentes: faltando.map((c) => c.componente) }) }, `${t('Download and install')}${total ? ` (${bytes(total)})` : ''}`))
      : null,
    instalando ? h('button', { class: 'btn pequeno', type: 'button', onclick: () => enviar({ tipo: 'vozCancelarInstalacao' }) }, t('Cancel installation')) : null,
    h('div', { class: 'grade' },
      selecao(t('Microphone'), v.dispositivo, [['', t('System default')], ...v.dispositivos.map((d) => [d.id, d.nome] as [string, string])], (d) => enviar({ tipo: 'vozConfigurar', dispositivo: d }), !v.dispositivos.length),
      selecao<ModeloVoz>(t('Transcription model'), v.modelo, (Object.keys(NOMES_MODELO) as ModeloVoz[]).map((m) => [m, NOMES_MODELO[m]]), (m) => enviar({ tipo: 'vozConfigurar', modelo: m })),
      selecao<EstadoVoz['idioma']>(t('Speech language'), v.idioma, [['pt', t('Portuguese')], ['en', t('English')], ['es', t('Spanish')], ['auto', t('Detect automatically')]], (i) => enviar({ tipo: 'vozConfigurar', idioma: i }))),
    caixa(t('Send the message automatically after transcribing'), v.envioAutomatico, (b) => enviar({ tipo: 'vozConfigurar', envioAutomatico: b })),
    h('p', { class: 'nota' }, t('Each recording lasts at most {time}.', { time: minSeg(v.limiteSegundos) })),
    h('h4', {}, t('Listen')),
    blocoMotorLeitura(v),
    !v.leitura.disponivel
      ? h('p', { class: 'nota' }, v.leitura.motivo ?? t('No system voice was found.'))
      : h('div', { class: 'pilha' },
        caixa(t('Read agent answers automatically'), v.leitura.ativa, (b) => enviar({ tipo: 'leituraConfigurar', ativa: b })),
        h('div', { class: 'grade' },
          selecao(t('Voice'), v.leitura.voz, v.leitura.vozes.map((x) => [x.id, x.nome] as [string, string]), (id) => enviar({ tipo: 'leituraConfigurar', voz: id }), !v.leitura.vozes.length),
          h('label', { class: 'rotulo' }, t('Speed'), h('span', { class: 'linha' }, velocidade, rotuloVel))),
        h('p', { class: 'nota' }, t('Reading uses the voice installed on your operating system. Code blocks are not read.'))));
}

// ---------- chats e memoria persistente (v4) ----------
let listaChats: ResumoChat[] = [];
let buscaAtual = '';
let memorias: Memoria[] = [];
let abaChats: 'conversas' | 'memoria' = 'conversas';
let renomeando: string | null = null;
let excluindo: string | null = null;
let editandoMemoria: string | null = null;
let temporizadorBusca: number | undefined;
const campoBusca = h('input', { class: 'campo busca', type: 'search', placeholder: t('Search titles and messages'), 'aria-label': t('Search chats') });
campoBusca.addEventListener('input', () => {
  clearTimeout(temporizadorBusca);
  temporizadorBusca = window.setTimeout(() => enviar({ tipo: 'listarChats', busca: campoBusca.value.trim() || undefined }), 250);
});
const novaMemoria = h('textarea', { class: 'campo', rows: 2, maxlength: 500, placeholder: t('E.g.: Use pnpm in this project. Always answer formally.'), 'aria-label': t('New memory') });

function quandoRelativo(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hoje = new Date();
  const dias = Math.floor((new Date(hoje.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000);
  const hm = d.toLocaleTimeString(localeIntl, { hour: '2-digit', minute: '2-digit' });
  if (dias === 0) return t('today, {time}', { time: hm });
  if (dias === 1) return t('yesterday, {time}', { time: hm });
  if (dias < 7) return d.toLocaleDateString(localeIntl, { weekday: 'long' });
  return d.toLocaleDateString(localeIntl, { day: '2-digit', month: '2-digit', year: dias > 300 ? '2-digit' : undefined });
}

function abrirChats(aba: typeof abaChats = 'conversas'): void {
  abaChats = aba;
  if (aba === 'conversas') enviar({ tipo: 'listarChats', busca: buscaAtual || undefined });
  else enviar({ tipo: 'listarMemorias' });
  irPara('chats');
}

function itemChat(c: ResumoChat): HTMLElement {
  const atual = E?.chat.id === c.id;
  if (renomeando === c.id) {
    const inp = h('input', { class: 'campo', type: 'text', value: c.titulo, maxlength: 120, 'aria-label': t('New title') });
    const salvar = () => { const t = inp.value.trim(); if (t && t !== c.titulo) enviar({ tipo: 'renomearChat', id: c.id, titulo: t }); renomeando = null; renderTudo(); };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') salvar(); if (e.key === 'Escape') { renomeando = null; renderTudo(); } });
    requestAnimationFrame(() => { inp.focus(); inp.select(); });
    return h('li', { class: 'chat-item editando' }, inp,
      h('div', { class: 'linha' },
        h('button', { class: 'btn pequeno primario', type: 'button', onclick: salvar }, t('Save')),
        h('button', { class: 'btn pequeno', type: 'button', onclick: () => { renomeando = null; renderTudo(); } }, t('Cancel'))));
  }
  if (excluindo === c.id) {
    return h('li', { class: 'chat-item confirmar', role: 'alertdialog', 'aria-label': t('Delete {title}', { title: c.titulo }) },
      h('p', {}, t('Delete "{title}" permanently? The {n} messages, actions and attachments of this chat will be removed from this computer.', { title: c.titulo, n: c.mensagens })),
      h('div', { class: 'linha' },
        h('button', { class: 'btn pequeno perigo', type: 'button', onclick: () => { enviar({ tipo: 'excluirChat', id: c.id }); excluindo = null; } }, t('Delete')),
        h('button', { class: 'btn pequeno', type: 'button', onclick: () => { excluindo = null; renderTudo(); } }, t('Cancel'))));
  }
  const meta = [c.desteProjeto ? null : (c.projetoNome ?? t('No project')), quandoRelativo(c.atualizadoEm), (c.mensagens === 1 ? t('1 message') : t('{n} messages', { n: c.mensagens })), c.agentes.length ? c.agentes.join(', ') : null]
    .filter(Boolean).join(' · ');
  return h('li', { class: `chat-item ${atual ? 'atual' : ''}` },
    h('button', {
      class: 'chat-abrir', type: 'button', 'aria-current': atual ? 'true' : undefined,
      onclick: () => { if (!atual) enviar({ tipo: 'abrirChat', id: c.id }); irPara('chat'); },
    },
      h('span', { class: 'chat-titulo' }, c.fixado ? icone('fixar') : null, c.titulo, atual ? h('span', { class: 'tag' }, t('open')) : null),
      h('span', { class: 'chat-meta' }, meta),
      c.trecho ? h('span', { class: 'chat-trecho' }, c.trecho) : null),
    h('span', { class: 'chat-acoes' },
      botaoIcone('fixar', c.fixado ? t('Unpin') : t('Pin to top'), () => enviar({ tipo: 'fixarChat', id: c.id, fixado: !c.fixado }), c.fixado ? 'ativo' : ''),
      botaoIcone('lapis', t('Rename'), () => { renomeando = c.id; renderTudo(); }),
      botaoIcone('exportar', t('Export as Markdown'), () => enviar({ tipo: 'exportarChat', id: c.id })),
      botaoIcone('lixeira', t('Delete'), () => { excluindo = c.id; renderTudo(); })));
}

function grupoChats(titulo: string, itens: ResumoChat[]): HTMLElement | null {
  if (!itens.length) return null;
  return h('section', { class: 'grupo-chats' }, h('h3', {}, titulo), h('ul', { class: 'lista-chats' }, ...itens.map(itemChat)));
}

function abaConversas(): HTMLElement {
  if (document.activeElement !== campoBusca && campoBusca.value !== buscaAtual) campoBusca.value = buscaAtual;
  const ordenar = (a: ResumoChat, b: ResumoChat) => b.atualizadoEm.localeCompare(a.atualizadoEm);
  const fixados = listaChats.filter((c) => c.fixado).sort(ordenar);
  const resto = listaChats.filter((c) => !c.fixado).sort(ordenar);
  const grupos = buscaAtual
    ? [grupoChats(t('Results for "{query}"', { query: buscaAtual }), [...fixados, ...resto])]
    : [
      grupoChats(t('Pinned'), fixados),
      grupoChats(t('This project'), resto.filter((c) => c.desteProjeto)),
      grupoChats(t('Other projects'), resto.filter((c) => !c.desteProjeto && c.projeto)),
      grupoChats(t('No project'), resto.filter((c) => !c.desteProjeto && !c.projeto)),
    ];
  const vazio = !listaChats.length;
  return h('div', { class: 'pilha' },
    h('div', { class: 'linha' }, campoBusca,
      h('button', { class: 'btn primario', type: 'button', onclick: () => { enviar({ tipo: 'novoChat' }); irPara('chat'); } }, icone('mais'), ` ${t('New chat')}`)),
    vazio ? h('p', { class: 'nota' }, buscaAtual ? t('No chats found.') : t('No chats yet.')) : null,
    ...grupos);
}

function itemMemoria(m: Memoria): HTMLElement {
  if (editandoMemoria === m.id) {
    const ta = h('textarea', { class: 'campo', rows: 3, maxlength: 500, 'aria-label': t('Edit memory') });
    ta.value = m.texto;
    requestAnimationFrame(() => ta.focus());
    return h('li', { class: 'memoria editando' }, ta,
      h('div', { class: 'linha' },
        h('button', { class: 'btn pequeno primario', type: 'button', onclick: () => { const t = ta.value.trim(); if (t) enviar({ tipo: 'salvarMemoria', id: m.id, escopo: m.escopo, texto: t, ativa: m.ativa }); editandoMemoria = null; } }, t('Save')),
        h('button', { class: 'btn pequeno', type: 'button', onclick: () => { editandoMemoria = null; renderTudo(); } }, t('Cancel'))));
  }
  const chave = h('input', { type: 'checkbox', checked: m.ativa, 'aria-label': m.ativa ? t('Disable memory') : t('Enable memory') });
  chave.addEventListener('change', () => enviar({ tipo: 'salvarMemoria', id: m.id, escopo: m.escopo, texto: m.texto, ativa: chave.checked }));
  return h('li', { class: `memoria ${m.ativa ? '' : 'off'}` },
    h('label', { class: 'interruptor', title: m.ativa ? t('Sent to agents') : t('Saved, but not sent') }, chave, h('span', { class: 'trilho' })),
    h('div', { class: 'memoria-corpo' },
      h('p', {}, m.texto),
      h('span', { class: 'nota' }, [m.origem === 'agente' ? t('proposed by {agent}', { agent: m.agente ?? t('agent') }) : t('added by you'), quandoRelativo(m.atualizadaEm)].join(' · '))),
    h('span', { class: 'chat-acoes' },
      botaoIcone('lapis', t('Edit'), () => { editandoMemoria = m.id; renderTudo(); }),
      botaoIcone('lixeira', t('Delete'), () => enviar({ tipo: 'excluirMemoria', id: m.id }))));
}

function abaMemoria(): HTMLElement {
  const projeto = E?.sala.projeto ?? null;
  const escopo = h('select', { class: 'campo', 'aria-label': t('Memory scope') },
    projeto ? h('option', { value: 'projeto', selected: true }, t('This project ({name})', { name: E?.sala.titulo ?? '' })) : null,
    h('option', { value: 'global', selected: !projeto }, t('Global (all projects)')));
  const salvar = () => {
    const t = novaMemoria.value.trim();
    if (!t) return;
    enviar({ tipo: 'salvarMemoria', escopo: escopo.value as Memoria['escopo'], texto: t });
    novaMemoria.value = '';
  };
  const globais = memorias.filter((m) => m.escopo === 'global');
  const deste = memorias.filter((m) => m.escopo === 'projeto' && m.projeto === projeto);
  const outros = memorias.filter((m) => m.escopo === 'projeto' && m.projeto !== projeto);
  const grupo = (titulo: string, itens: Memoria[], nota?: string) => itens.length
    ? h('section', { class: 'grupo-chats' }, h('h3', {}, titulo), nota ? h('p', { class: 'nota' }, nota) : null, h('ul', { class: 'lista-memorias' }, ...itens.map(itemMemoria)))
    : null;
  return h('div', { class: 'pilha' },
    h('p', { class: 'nota' }, t('Facts agents receive in every chat: preferences, decisions and conventions. Proposals are saved automatically on Full; other levels ask for your approval. Do not store passwords or keys here.')),
    h('div', { class: 'nova-memoria' }, novaMemoria,
      h('div', { class: 'linha' }, escopo, h('button', { class: 'btn primario', type: 'button', onclick: salvar }, t('Remember')))),
    h('p', { class: 'nota' }, t('Chat shortcut: /remember text (this project) or /remember-global text.')),
    grupo(t('Global'), globais),
    grupo(projeto ? t('This project') : t('No project'), deste),
    grupo(t('Other projects'), outros, t('Not sent in this window.')),
    !memorias.length ? h('p', { class: 'nota' }, t('No memories yet.')) : null);
}

function vistaChats(): HTMLElement {
  const aba = (id: typeof abaChats, rotulo: string) => h('button', {
    class: `aba ${abaChats === id ? 'sel' : ''}`, type: 'button', role: 'tab', 'aria-selected': abaChats === id ? 'true' : 'false',
    onclick: () => abrirChats(id),
  }, rotulo);
  return h('div', { class: 'pagina' },
    h('div', { class: 'pagina-topo' }, botaoIcone('voltar', t('Back to chat'), () => irPara('chat')), h('h2', {}, t('Chats'))),
    h('div', { class: 'abas', role: 'tablist' }, aba('conversas', t('Conversations')), aba('memoria', `${t('Memory')}${E?.memoriasAtivas ? ` (${E.memoriasAtivas})` : ''}`)),
    abaChats === 'conversas' ? abaConversas() : abaMemoria());
}

// Atalhos do composer: /lembrar e /lembrar-global.
function comandoMemoria(t: string): boolean {
  const tr = traduzir;
  const m = t.match(/^\/(?:lembrar|remember|recordar|merken)(-global)?\s+([\s\S]+)$/i);
  if (!m) return false;
  const global = !!m[1] || !E?.sala.projeto;
  enviar({ tipo: 'salvarMemoria', escopo: global ? 'global' : 'projeto', texto: m[2].trim().slice(0, 500) });
  avisar(global ? tr('Saved to global memory.') : tr('Saved to the memory of this project.'));
  return true;
}

// ---------- vistas: agentes e configuracoes ----------
function irPara(v: Vista): void { vista = v; salvarLocal({ vista: v }); renderTudo(); }

function cartaoAgente(a: Agente): HTMLElement {
  const papel = h('textarea', { class: 'campo', rows: 2, placeholder: t('Role of this agent in the room'), 'aria-label': t('Role of {name}', { name: a.nick }) });
  papel.value = a.papel;
  papel.addEventListener('change', () => enviar({ tipo: 'agentePapel', id: a.id, papel: papel.value.trim() }));
  const modo = h('select', { class: 'campo', 'aria-label': t('Mode of {name}', { name: a.nick }), disabled: !a.habilitado },
    ...(Object.keys(MODOS) as ModoAgente[]).map((m) => h('option', { value: m, selected: m === a.modo }, MODOS[m])));
  modo.addEventListener('change', () => enviar({ tipo: 'agenteModo', id: a.id, modo: modo.value as ModoAgente }));
  const chave = h('input', { type: 'checkbox', checked: a.habilitado, disabled: !a.instalado, 'aria-label': t('Enable {name}', { name: a.nick }) });
  chave.addEventListener('change', () => enviar({ tipo: 'agenteHabilitar', id: a.id, habilitado: chave.checked }));
  return h('article', { class: `cartao-ag c-${a.cor} ${a.habilitado ? '' : 'off'}` },
    h('div', { class: 'linha' },
      h('span', { class: 'ponto' }),
      h('strong', {}, a.nick),
      h('span', { class: 'tag' }, a.tipo === 'cli' ? 'CLI' : 'API'),
      a.origem !== 'embutido' ? h('span', { class: 'tag' }, a.origem === 'manifesto' ? t('manifest') : t('extension')) : null,
      h('label', { class: 'interruptor' }, chave, h('span', { class: 'trilho' }))),
    h('div', { class: 'linha sub' },
      !a.instalado ? h('span', { class: 'estado ruim' }, t('not installed'))
        : h('span', { class: `estado ${a.login === 'conectado' || a.login === 'chave_configurada' ? 'bom' : 'ruim'}` }, LOGIN[a.login]),
      a.versao ? h('span', { class: 'versao' }, a.versao) : null,
      botaoLogin(a),
      a.tipo === 'api' || a.origem === 'manifesto'
        ? h('button', { class: 'btn fantasma pequeno', type: 'button', title: t('Model, address (baseUrl) and command in VS Code settings'), onclick: () => enviar({ tipo: 'agenteConfigurar', id: a.id }) }, t('Model and address')) : null),
    painelLogin(a),
    h('label', { class: 'rotulo' }, t('Permission mode'), modo),
    h('label', { class: 'rotulo' }, t('Role'), papel),
    a.temSessao ? h('button', { class: 'btn fantasma pequeno', type: 'button', title: t('Forgets the conversation thread of this agent'), onclick: () => enviar({ tipo: 'agenteNovaSessao', id: a.id }) }, t('Start a new session')) : null);
}

// ---------- login sem terminal (v2) ----------
const conectado = (a: Agente) => a.login === 'conectado' || a.login === 'chave_configurada';
const EM_ANDAMENTO = new Set(['iniciando', 'aguardando_navegador', 'codigo_dispositivo', 'validando']);

function botaoLogin(a: Agente): HTMLElement | null {
  if (!a.instalado || !a.opcoesLogin.length) return null;
  if (conectado(a)) {
    return h('button', { class: 'btn fantasma pequeno', type: 'button', title: t('Sign out of {name}', { name: a.nick }), onclick: () => enviar({ tipo: 'logout', id: a.id }) }, t('Sign out'));
  }
  const aberto = loginAberto.has(a.id);
  return h('button', {
    class: `btn pequeno ${aberto ? '' : 'primario'}`, type: 'button', 'aria-expanded': aberto ? 'true' : 'false',
    onclick: () => { if (aberto) loginAberto.delete(a.id); else loginAberto.add(a.id); renderTudo(); },
  }, aberto ? t('Close') : t('Sign in'));
}

function campos(a: Agente): { chave: HTMLInputElement; baseUrl: HTMLInputElement } {
  let c = camposChave.get(a.id);
  if (!c) {
    c = {
      chave: h('input', { class: 'campo', type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: t('Paste the key here'), 'aria-label': t('API key for {name}', { name: a.nick }) }),
      baseUrl: h('input', { class: 'campo', type: 'url', placeholder: 'https://server/v1', 'aria-label': t('API address for {name}', { name: a.nick }) }),
    };
    camposChave.set(a.id, c);
  }
  return c;
}

function formularioChave(a: Agente, o: OpcaoLogin): HTMLElement {
  const c = campos(a);
  const pedeEndereco = o.variante === 'com_baseUrl';
  const btn = h('button', { class: 'btn primario', type: 'button' }, t('Validate and save'));
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
      o.linkChave ? h('button', { class: 'btn fantasma pequeno', type: 'button', title: o.linkChave, onclick: () => enviar({ tipo: 'abrirLinkLogin', url: o.linkChave! }) }, `${t('Create a key on the official site')} `, icone('exportar')) : null),
    pedeEndereco ? h('label', { class: 'rotulo' }, t('API address'), c.baseUrl) : null,
    h('label', { class: 'rotulo' }, t('API key'), c.chave),
    h('div', { class: 'linha' }, btn, h('span', { class: 'nota' }, t('The key is tested with the provider before being stored in the VS Code vault.'))),
    o.ajuda ? h('p', { class: 'nota' }, o.ajuda) : null);
}

function painelProgresso(a: Agente, p: ProgressoLogin): HTMLElement {
  const cancelar = h('button', { class: 'btn pequeno', type: 'button', onclick: () => enviar({ tipo: 'loginCancelar', id: a.id }) }, t('Cancel'));
  const abrir = (rotulo: string, primario = false) => p.url
    ? h('button', { class: `btn pequeno ${primario ? 'primario' : ''}`, type: 'button', title: p.url, onclick: () => enviar({ tipo: 'abrirLinkLogin', url: p.url! }) }, rotulo)
    : null;
  switch (p.etapa) {
    case 'codigo_dispositivo': {
      const copiar = h('button', { class: 'bi', type: 'button', title: t('Copy code'), 'aria-label': t('Copy code') }, icone('copiar'));
      copiar.onclick = () => void navigator.clipboard.writeText(p.codigo ?? '').then(() => copiar.classList.add('ok'));
      return h('div', { class: 'login-progresso', role: 'status' },
        h('p', {}, t('Open the sign-in page and enter this code:')),
        h('div', { class: 'codigo-dispositivo' }, h('code', {}, p.codigo ?? ''), copiar),
        h('div', { class: 'linha' }, abrir(t('Open sign-in page'), true), cancelar),
        h('p', { class: 'nota' }, t('This screen updates by itself when sign-in finishes.')));
    }
    case 'aguardando_navegador':
      return h('div', { class: 'login-progresso', role: 'status' },
        h('p', {}, h('span', { class: 'girando', 'aria-hidden': 'true' }), ` ${t('Finish signing in in the browser window.')}`),
        h('div', { class: 'linha' }, abrir(t('Open the link again')), cancelar),
        h('p', { class: 'nota' }, t('This screen updates by itself when sign-in finishes.')));
    case 'erro':
      return h('div', { class: 'login-progresso erro', role: 'alert' },
        h('p', {}, p.mensagem ?? t('Could not sign in.')),
        h('button', { class: 'btn pequeno', type: 'button', onclick: () => { progressos.delete(a.id); renderTudo(); } }, t('Try again')));
    default:
      return h('div', { class: 'login-progresso', role: 'status' },
        h('p', {}, h('span', { class: 'girando', 'aria-hidden': 'true' }), ' ', p.mensagem ?? (p.etapa === 'validando' ? t('Validating the key with the provider...') : t('Starting sign-in...'))),
        p.etapa === 'validando' ? null : h('div', { class: 'linha' }, cancelar));
  }
}

function painelLogin(a: Agente): HTMLElement | null {
  if (!a.instalado) return null;
  if (!a.opcoesLogin.length) {
    return a.login === 'desconectado' ? h('p', { class: 'nota' }, t('The local service did not respond. Check that it is running.')) : null;
  }
  const p = progressos.get(a.id);
  const andamento = !!p && EM_ANDAMENTO.has(p.etapa);
  if (conectado(a) && !andamento) return a.conta ? h('p', { class: 'nota conta' }, t('Connected: {account}', { account: a.conta })) : null;
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
      }, o.metodo === 'dispositivo' ? o.rotulo : t('Sign in with {option}', { option: o.rotulo })),
      o.ajuda ? h('span', { class: 'nota' }, o.ajuda) : null))) : null,
    remotos.length && chaves.length ? h('div', { class: 'separador' }, t('or')) : null,
    ...chaves.map((o) => formularioChave(a, o)));
}

function vistaAgentes(): HTMLElement {
  return h('div', { class: 'pagina' },
    h('div', { class: 'pagina-topo' }, botaoIcone('voltar', t('Back to chat'), () => irPara('chat')), h('h2', {}, t('Agents'))),
    h('p', { class: 'nota' }, t('Enable, sign in and set the role and permission of each agent. All enabled agents join the same room.')),
    ...(E?.agentes ?? []).map(cartaoAgente),
    h('button', { class: 'btn', type: 'button', onclick: () => enviar({ tipo: 'instalarAgente' }) }, icone('mais'), ` ${t('Install another agent')}`));
}

function seletorNivel(atual: NivelPermissao, aoEscolher: (n: NivelPermissao, confirmacao?: string) => void): HTMLElement {
  const confirmacao = h('input', { class: 'campo', type: 'text', placeholder: CONFIRMACAO_NIVEL_TOTAL, 'aria-label': t('Type {phrase} to confirm', { phrase: CONFIRMACAO_NIVEL_TOTAL }) });
  const btnTotal = h('button', { class: 'btn perigo', type: 'button', disabled: true }, t('Enable full access'));
  confirmacao.addEventListener('input', () => { btnTotal.disabled = confirmacao.value.trim() !== CONFIRMACAO_NIVEL_TOTAL; });
  btnTotal.addEventListener('click', () => aoEscolher('total', confirmacao.value.trim()));
  const avisoTotal = h('div', { class: 'aviso-total', hidden: true, role: 'region', 'aria-label': t('Risks of full access') },
    h('h3', {}, t('Risks of full access')),
    h('ul', {}, ...RISCOS_TOTAL.map((r) => h('li', {}, r))),
    h('p', {}, `${t('To enable, type')} `, h('code', {}, CONFIRMACAO_NIVEL_TOTAL), ':'),
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
    h('div', { class: 'pagina-topo' }, botaoIcone('voltar', t('Back to chat'), () => irPara('chat')), h('h2', {}, t('Settings'))),
    h('h3', {}, t('Permission level')),
    seletorNivel(c.nivel, (n, conf) => enviar({ tipo: 'definirNivel', nivel: n, confirmacao: conf })),
    h('h3', {}, t('Room')),
    campoTexto(t('Your nickname'), c.nick, (s) => s && enviar({ tipo: 'configurar', parcial: { nick: s } })),
    campoTexto(t('Topic'), c.topico, (s) => enviar({ tipo: 'configurar', parcial: { topico: s } })),
    campoNumero(t('Automatic hand-offs between agents (0 turns off)'), c.passagensAutomaticas, 0, 20, (n) => enviar({ tipo: 'configurar', parcial: { passagensAutomaticas: n } })),
    campoNumero(t('Maximum time per answer (minutes)'), c.timeoutMinutos, 1, 120, (n) => enviar({ tipo: 'configurar', parcial: { timeoutMinutos: n } })),
    h('h3', {}, t('Attachment limits')),
    h('p', { class: 'nota' }, t('Spreadsheets are never read in full: Orquestrador sends only the header and a sample of rows.')),
    h('div', { class: 'grade' },
      campoNumero(t('Spreadsheet: maximum size (MB)'), l.planilhaMaxMB, 1, 5, lim('planilhaMaxMB')),
      campoNumero(t('Spreadsheet: rows per sheet'), l.planilhaLinhasPorAba, 5, 200, lim('planilhaLinhasPorAba')),
      campoNumero(t('Spreadsheet: sheets'), l.planilhaAbas, 1, 10, lim('planilhaAbas')),
      campoNumero(t('Full text up to (KB)'), l.textoIntegralKB, 16, 512, lim('textoIntegralKB')),
      campoNumero(t('Text: maximum size (MB)'), l.textoMaxMB, 1, 2, lim('textoMaxMB')),
      campoNumero(t('Image: maximum size (MB)'), l.imagemMaxMB, 1, 10, lim('imagemMaxMB')),
      campoNumero(t('PDF/Word: maximum size (MB)'), l.documentoMaxMB, 1, 20, lim('documentoMaxMB'))),
    secaoVoz(),
    h('h3', {}, t('Data')),
    h('p', { class: 'nota' }, t('Conversations, actions and attachments stay only on this computer, in ~/.orquestra/dados. Nothing is sent without your request.')),
    h('button', { class: 'btn', type: 'button', onclick: () => enviar({ tipo: 'exportarConversa' }) }, icone('exportar'), ` ${t('Export this conversation')}`));
}

// ---------- assistente da primeira execucao ----------
function vistaAssistente(): HTMLElement {
  const passos = [t('Welcome'), t('Agents'), t('Permissions'), t('Ready')];
  const navegar = (d: number) => { passoAssistente = Math.max(0, Math.min(passos.length - 1, passoAssistente + d)); renderTudo(); };
  let corpo: HTMLElement;
  if (passoAssistente === 0) {
    corpo = h('div', {},
      h('h2', {}, t('Welcome to Orquestrador Fagulha')),
      h('p', {}, t('One room per VS Code window where your AI agents talk to each other and to you, share what they read and write, and only act within the permissions you set.')),
      h('ul', { class: 'lista-simples' },
        h('li', {}, t('Everything is stored only on this computer.')),
        h('li', {}, t('Nothing is published or sent without your request.')),
        h('li', {}, t('API keys are kept in the secure VS Code vault.'))));
  } else if (passoAssistente === 1) {
    corpo = h('div', {}, h('h2', {}, t('Agents found')),
      h('p', { class: 'nota' }, t('Enable the ones that will take part and sign in. You can change this later.')),
      ...(E?.agentes ?? []).map(cartaoAgente));
  } else if (passoAssistente === 2) {
    corpo = h('div', {}, h('h2', {}, t('Permission level')),
      h('p', { class: 'nota' }, t('Defines how much agents can do without waiting for your approval.')),
      seletorNivel(E!.configuracao.nivel, (n, conf) => enviar({ tipo: 'definirNivel', nivel: n, confirmacao: conf })));
  } else {
    const ativos = E?.agentes.filter((a) => a.habilitado && a.instalado) ?? [];
    corpo = h('div', {}, h('h2', {}, t('All set')),
      h('p', {}, t('Level: {level}. Agents: {agents}.', { level: NIVEIS[E!.configuracao.nivel].titulo, agents: ativos.map((a) => a.nick).join(', ') || t('none') })),
      h('p', { class: 'nota' }, t('Mention an agent with @ to call it.')));
  }
  return h('div', { class: 'pagina assistente' },
    h('ol', { class: 'passos' }, ...passos.map((p, i) => h('li', { class: i === passoAssistente ? 'atual' : i < passoAssistente ? 'feito' : '' }, p))),
    corpo,
    h('div', { class: 'botoes' },
      passoAssistente > 0 ? h('button', { class: 'btn', type: 'button', onclick: () => navegar(-1) }, t('Back')) : null,
      passoAssistente < passos.length - 1
        ? h('button', { class: 'btn primario', type: 'button', onclick: () => navegar(1) }, t('Continue'))
        : h('button', { class: 'btn primario', type: 'button', onclick: () => enviar({ tipo: 'concluirAssistente' }) }, t('Open the room'))));
}

// ---------- montagem ----------
function renderTudo(): void {
  if (!E) return;
  const assistente = E.primeiraExecucao;
  const chat = !assistente && vista === 'chat';
  app.dataset.vista = assistente ? 'assistente' : vista;
  renderCabecalho(); renderFaixa(); renderFases(); renderAprovacoes(); renderPerguntas(); renderChipsComposer(); renderVoz();
  [faixa, lista, composer].forEach((el) => { el.hidden = !chat; });
  cabecalho.hidden = assistente;
  vistaExtra.hidden = chat;
  if (assistente) vistaExtra.replaceChildren(vistaAssistente());
  else if (vista === 'agentes') vistaExtra.replaceChildren(vistaAgentes());
  else if (vista === 'config') vistaExtra.replaceChildren(vistaConfig());
  else if (vista === 'chats') vistaExtra.replaceChildren(vistaChats());
  else if (vista === 'integracoes') vistaExtra.replaceChildren(vistaIntegracoes());
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
      app.replaceChildren(h('div', { class: 'msg erro' }, t('Incompatible protocol version (host {host}, interface {ui}). Reload the window.', { host: m.estado.versaoProtocolo, ui: VERSAO_PROTOCOLO })));
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
    case 'chats':
      listaChats = m.lista; buscaAtual = m.busca ?? '';
      if (vista === 'chats') renderTudo();
      break;
    case 'chat':
      E.chat = m.chat;
      listaChats = substituir(listaChats, m.chat);
      renderCabecalho();
      if (vista === 'chats') renderTudo();
      break;
    case 'integracoes':
      receberIntegracoes(m.lista);
      E.integracoesConectadas = m.lista.filter((x) => x.estado === 'conectada' && x.ativa).length;
      if (vista === 'integracoes') renderTudo(); else renderCabecalho();
      break;
    case 'integracao':
      receberIntegracao(m.integracao);
      if (vista === 'integracoes') renderTudo();
      break;
    case 'skills':
      receberSkills(m.lista);
      E.skillsAtivas = m.lista.filter((x) => x.ativa).length;
      if (vista === 'integracoes') renderTudo();
      break;
    case 'skill':
      receberSkill(m.nome, m.conteudo);
      if (vista === 'integracoes') renderTudo();
      break;
    case 'memorias':
      memorias = m.lista;
      E.memoriasAtivas = m.lista.filter((x) => x.ativa && (x.escopo === 'global' || x.projeto === E!.sala.projeto)).length;
      if (vista === 'chats') renderTudo();
      break;
    case 'fase': {
      const ag = E.agentes.find((a) => a.id === m.agente);
      if (ag) { ag.fase = m.fase; renderFases(); renderFaixa(); }
      break;
    }
    case 'pergunta':
      E.perguntas = substituir(E.perguntas, m.pergunta);
      renderPerguntas();
      break;
    case 'perguntaResolvida':
      E.perguntas = E.perguntas.filter((x) => x.id !== m.id);
      rascunhoRespostas.delete(m.id);
      renderPerguntas();
      break;
    case 'login': {
      const p = m.progresso;
      progressos.set(p.agente, p);
      if (p.etapa === 'conectado' || p.etapa === 'cancelado') {
        loginAberto.delete(p.agente); progressos.delete(p.agente);
        if (p.etapa === 'conectado') { camposChave.delete(p.agente); avisar(t('{name} connected{account}.', { name: E.agentes.find((a) => a.id === p.agente)?.nick ?? p.agente, account: p.conta ? `: ${p.conta}` : '' })); }
      }
      renderTudo(); break;
    }
  }
});

app.append(h('div', { class: 'soltar', 'aria-hidden': 'true' }, icone('clipe'), t('Drop to attach')));
iniciarIntegracoes({ renderTudo: () => renderTudo(), voltar: () => irPara('chat'), avisar: (x) => avisar(x) });
enviar({ tipo: 'pronto' });
