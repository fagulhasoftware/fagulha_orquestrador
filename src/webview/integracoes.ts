/// <reference lib="dom" />
// Integrations (MCP gateway) and skills view of the chat UI (contract v6, 0.4.0). Owner: Claude.
// Secrets typed here travel once to the host (conectarIntegracao) and are cleared from the DOM right after.
import type { CampoIntegracao, CategoriaAcao, Integracao, Skill, TransporteIntegracao, AutenticacaoIntegracao } from '../shared/protocolo';
import { botaoIcone, bytes, enviar, h, icone } from './util';
import { t } from './i18n';

export type AbaIntegracoes = 'integracoes' | 'skills';

interface Contexto {
  renderTudo: () => void;
  voltar: () => void;
  avisar: (texto: string) => void;
}

let ctx: Contexto | null = null;
let integracoes: Integracao[] = [];
let skills: Skill[] = [];
let aba: AbaIntegracoes = 'integracoes';
let conectando: string | null = null;          // id with the connect form open
let ferramentasAbertas = new Set<string>();
let personalizadaAberta = false;
let skillAberta: { nome: string; conteudo: string } | null = null;
let removendoSkill: string | null = null;
let urlGithub = '';
const camposDigitados = new Map<string, Map<string, HTMLInputElement>>();

export function iniciarIntegracoes(c: Contexto): void { ctx = c; }
export function abrirIntegracoes(qual: AbaIntegracoes = 'integracoes'): void {
  aba = qual;
  enviar(qual === 'integracoes' ? { tipo: 'listarIntegracoes' } : { tipo: 'listarSkills' });
}
export function receberIntegracoes(lista: Integracao[]): void { integracoes = lista; }
export function receberIntegracao(item: Integracao): void {
  const i = integracoes.findIndex((x) => x.id === item.id);
  if (i < 0) integracoes = [...integracoes, item];
  else { integracoes = integracoes.slice(); integracoes[i] = item; }
  if (item.estado === 'conectada' && conectando === item.id) { conectando = null; camposDigitados.delete(item.id); ctx?.avisar(t('{name} connected.', { name: item.nome })); }
}
export function receberSkills(lista: Skill[]): void { skills = lista; }
export function receberSkill(nome: string, conteudo: string): void { skillAberta = { nome, conteudo }; }

const ROTULO_ESTADO: Record<Integracao['estado'], string> = {
  desconectada: t('not connected'),
  conectando: t('connecting...'),
  conectada: t('connected'),
  erro: t('error'),
  requer_reconexao: t('needs to reconnect'),
};
const ROTULO_CATEGORIA: Partial<Record<CategoriaAcao, string>> = {
  rede_leitura: t('read'),
  externo: t('write'),
  publicacao: t('publish'),
  irreversivel_externo: t('irreversible'),
};

// ---------------------------------------------------------------- integrations tab
function formularioConexao(it: Integracao): HTMLElement {
  let campos = camposDigitados.get(it.id);
  if (!campos) { campos = new Map(); camposDigitados.set(it.id, campos); }
  const linhas = it.campos.map((c: CampoIntegracao) => {
    let el = campos!.get(c.chave);
    if (!el) {
      el = h('input', {
        class: c.tipo === 'booleano' ? '' : 'campo',
        type: c.tipo === 'segredo' ? 'password' : c.tipo === 'booleano' ? 'checkbox' : c.tipo === 'url' ? 'url' : 'text',
        autocomplete: 'off', spellcheck: 'false', 'aria-label': t(c.rotulo),
      });
      campos!.set(c.chave, el);
    }
    if (c.tipo === 'booleano') return h('label', { class: 'caixa' }, el, ` ${t(c.rotulo)}`, c.ajuda ? h('span', { class: 'nota' }, ` — ${t(c.ajuda)}`) : null);
    return h('label', { class: 'rotulo' }, `${t(c.rotulo)}${c.obrigatorio ? ' *' : ''}`, el, c.ajuda ? h('span', { class: 'nota' }, t(c.ajuda)) : null);
  });
  const btn = h('button', { class: 'btn primario', type: 'button' }, it.autenticacao === 'oauth' || it.autenticacao === 'oauth_cliente_proprio' ? t('Sign in and connect') : t('Connect'));
  const validar = () => {
    btn.disabled = it.campos.some((c) => c.obrigatorio && c.tipo !== 'booleano' && !campos!.get(c.chave)?.value.trim());
  };
  campos.forEach((el) => el.addEventListener('input', validar));
  validar();
  btn.addEventListener('click', () => {
    const valores: Record<string, string | boolean> = {};
    for (const c of it.campos) {
      const el = campos!.get(c.chave)!;
      valores[c.chave] = c.tipo === 'booleano' ? el.checked : el.value.trim();
      if (c.tipo === 'segredo') el.value = '';   // secrets do not stay in the DOM
    }
    enviar({ tipo: 'conectarIntegracao', id: it.id, valores });
    ctx?.renderTudo();
  });
  return h('div', { class: 'login' },
    h('p', { class: 'nota aviso-privacidade' }, t('Content that agents read from {name} is sent to the AI provider of the agent that uses it. Every call goes through the approval gate.', { name: it.nome })),
    ...linhas,
    it.autenticacao === 'oauth' ? h('p', { class: 'nota' }, t('Your browser will open to sign in. The token is stored only in the VS Code vault.')) : null,
    h('div', { class: 'linha' }, btn,
      h('button', { class: 'btn pequeno', type: 'button', onclick: () => { conectando = null; ctx?.renderTudo(); } }, t('Cancel'))));
}

function cartaoIntegracao(it: Integracao): HTMLElement {
  const conectada = it.estado === 'conectada';
  const chave = h('input', { type: 'checkbox', checked: it.ativa, disabled: !conectada, 'aria-label': t('Offer {name} tools to agents', { name: it.nome }) });
  chave.addEventListener('change', () => enviar({ tipo: 'alternarIntegracao', id: it.id, ativa: chave.checked }));
  const abertas = ferramentasAbertas.has(it.id);
  return h('article', { class: `cartao-ag cartao-integracao s-${it.estado} ${conectada && !it.ativa ? 'off' : ''}` },
    h('div', { class: 'linha' },
      h('strong', {}, it.nome),
      it.oficial ? h('span', { class: 'tag oficial', title: t('Server published by the vendor') }, t('official')) : h('span', { class: 'tag', title: t('Not verified by Orquestrador') }, t('custom')),
      it.preview ? h('span', { class: 'tag aviso', title: t('The vendor marks this server as preview') }, t('preview')) : null,
      h('span', { class: `estado ${conectada ? 'bom' : it.estado === 'erro' || it.estado === 'requer_reconexao' ? 'ruim' : ''}` }, ROTULO_ESTADO[it.estado]),
      h('label', { class: 'interruptor', title: t('Offer tools to agents') }, chave, h('span', { class: 'trilho' }))),
    h('p', { class: 'nota' }, t(it.descricao)),
    h('code', { class: 'endpoint', title: it.endpoint }, it.endpoint),
    it.requisitos.length ? h('ul', { class: 'requisitos' }, ...it.requisitos.map((r) => h('li', {}, t(r)))) : null,
    it.conta ? h('p', { class: 'nota conta' }, t('Account: {account}', { account: it.conta })) : null,
    it.mensagem && it.estado !== 'conectada' ? h('p', { class: `nota ${it.estado === 'erro' ? 'erro-texto' : ''}` }, t(it.mensagem)) : null,
    conectada && it.ferramentas.length
      ? h('details', { class: 'ferramentas-integracao', open: abertas, ontoggle: (e: Event) => { const d = e.target as HTMLDetailsElement; if (d.open) ferramentasAbertas.add(it.id); else ferramentasAbertas.delete(it.id); } },
        h('summary', {}, it.ferramentas.length === 1 ? t('1 tool') : t('{n} tools', { n: it.ferramentas.length })),
        h('ul', {}, ...it.ferramentas.map((f) => h('li', {},
          h('code', {}, `${it.id}__${f.nome}`),
          h('span', { class: `tag cat-${f.categoria}` }, ROTULO_CATEGORIA[f.categoria] ?? f.categoria),
          f.descricao ? h('span', { class: 'nota' }, ` ${f.descricao}`) : null))))
      : null,
    conectando === it.id && !conectada ? formularioConexao(it) : null,
    h('div', { class: 'linha' },
      conectada || it.estado === 'requer_reconexao'
        ? h('button', { class: 'btn pequeno', type: 'button', onclick: () => enviar({ tipo: 'desconectarIntegracao', id: it.id }) }, t('Disconnect'))
        : conectando === it.id ? null
          : h('button', { class: 'btn pequeno primario', type: 'button', disabled: it.estado === 'conectando', onclick: () => { conectando = it.id; ctx?.renderTudo(); } }, it.estado === 'erro' ? t('Try again') : t('Connect')),
      it.estado === 'requer_reconexao' ? h('button', { class: 'btn pequeno primario', type: 'button', onclick: () => { conectando = it.id; ctx?.renderTudo(); } }, t('Reconnect')) : null,
      it.documentacao ? h('button', { class: 'btn fantasma pequeno', type: 'button', title: it.documentacao, onclick: () => enviar({ tipo: 'abrirLink', url: it.documentacao! }) }, `${t('Documentation')} `, icone('exportar')) : null,
      it.origem === 'personalizada' ? botaoIcone('lixeira', t('Remove'), () => enviar({ tipo: 'removerIntegracao', id: it.id })) : null));
}

function formularioPersonalizada(): HTMLElement {
  const nome = h('input', { class: 'campo', type: 'text', maxlength: 60, placeholder: 'My MCP server', 'aria-label': t('Name') });
  const transporte = h('select', { class: 'campo', 'aria-label': t('Transport') },
    h('option', { value: 'http' }, t('Remote URL (HTTP)')),
    h('option', { value: 'sse' }, t('Remote URL (SSE)')),
    h('option', { value: 'stdio' }, t('Local command')));
  const endpoint = h('input', { class: 'campo', type: 'text', placeholder: 'https://example.com/mcp', 'aria-label': t('Address or command') });
  const auth = h('select', { class: 'campo', 'aria-label': t('Authentication') },
    h('option', { value: 'oauth' }, t('Sign in with the browser (OAuth)')),
    h('option', { value: 'token' }, t('Access token')),
    h('option', { value: 'nenhuma' }, t('None')));
  transporte.addEventListener('change', () => { endpoint.placeholder = transporte.value === 'stdio' ? 'npx -y @scope/mcp-server' : 'https://example.com/mcp'; });
  const btn = h('button', { class: 'btn primario', type: 'button' }, t('Add'));
  btn.addEventListener('click', () => {
    if (!nome.value.trim() || !endpoint.value.trim()) return ctx?.avisar(t('Fill in the name and the address or command.'));
    enviar({ tipo: 'adicionarIntegracaoPersonalizada', nome: nome.value.trim(), transporte: transporte.value as TransporteIntegracao, endpoint: endpoint.value.trim(), autenticacao: auth.value as AutenticacaoIntegracao });
    personalizadaAberta = false; ctx?.renderTudo();
  });
  return h('div', { class: 'login' },
    h('p', { class: 'nota aviso-privacidade' }, t('Custom servers are not verified by Orquestrador. Only add servers you trust: they can read and change data in the services they connect to.')),
    h('label', { class: 'rotulo' }, t('Name'), nome),
    h('label', { class: 'rotulo' }, t('Transport'), transporte),
    h('label', { class: 'rotulo' }, t('Address or command'), endpoint),
    h('label', { class: 'rotulo' }, t('Authentication'), auth),
    h('div', { class: 'linha' }, btn, h('button', { class: 'btn pequeno', type: 'button', onclick: () => { personalizadaAberta = false; ctx?.renderTudo(); } }, t('Cancel'))));
}

function abaIntegracoes(): HTMLElement {
  const catalogo = integracoes.filter((i) => i.origem === 'catalogo');
  const proprias = integracoes.filter((i) => i.origem === 'personalizada');
  return h('div', { class: 'pilha' },
    h('p', { class: 'nota' }, t('Connect a platform once and every agent in the room can use it. Each call goes through the approval gate: reading counts as web access, writing as external, sending or publishing as publication, deleting as irreversible.')),
    catalogo.length ? h('section', { class: 'grupo-chats' }, h('h3', {}, t('Catalog')), ...catalogo.map(cartaoIntegracao)) : h('p', { class: 'nota' }, t('Loading integrations...')),
    h('section', { class: 'grupo-chats' }, h('h3', {}, t('Custom')),
      ...proprias.map(cartaoIntegracao),
      personalizadaAberta ? formularioPersonalizada()
        : h('button', { class: 'btn', type: 'button', onclick: () => { personalizadaAberta = true; ctx?.renderTudo(); } }, icone('mais'), ` ${t('Add custom integration')}`)));
}

// ---------------------------------------------------------------- skills tab
function itemSkill(s: Skill): HTMLElement {
  if (removendoSkill === s.nome) {
    return h('li', { class: 'chat-item confirmar', role: 'alertdialog' },
      h('p', {}, t('Remove the skill "{name}" from this computer?', { name: s.nome })),
      h('div', { class: 'linha' },
        h('button', { class: 'btn pequeno perigo', type: 'button', onclick: () => { enviar({ tipo: 'removerSkill', nome: s.nome }); removendoSkill = null; } }, t('Remove')),
        h('button', { class: 'btn pequeno', type: 'button', onclick: () => { removendoSkill = null; ctx?.renderTudo(); } }, t('Cancel'))));
  }
  const chave = h('input', { type: 'checkbox', checked: s.ativa, 'aria-label': t('Enable skill {name}', { name: s.nome }) });
  chave.addEventListener('change', () => enviar({ tipo: 'alternarSkill', nome: s.nome, ativa: chave.checked }));
  return h('li', { class: `memoria ${s.ativa ? '' : 'off'}` },
    h('label', { class: 'interruptor' }, chave, h('span', { class: 'trilho' })),
    h('div', { class: 'memoria-corpo' },
      h('p', {}, h('strong', {}, s.nome), ` — ${s.descricao}`),
      h('span', { class: 'nota' }, [({ pasta: t('folder'), zip: 'zip', github: 'GitHub' })[s.origem], bytes(s.bytes), s.fonte ?? ''].filter(Boolean).join(' · '))),
    h('span', { class: 'chat-acoes' },
      botaoIcone('lapis', t('View'), () => enviar({ tipo: 'verSkill', nome: s.nome })),
      botaoIcone('lixeira', t('Remove'), () => { removendoSkill = s.nome; ctx?.renderTudo(); })));
}

function abaSkills(): HTMLElement {
  const github = h('input', { class: 'campo', type: 'url', placeholder: 'https://github.com/owner/repo/tree/main/skills/name', value: urlGithub, 'aria-label': t('GitHub address of the skill') });
  github.addEventListener('input', () => { urlGithub = github.value; });
  return h('div', { class: 'pilha' },
    h('p', { class: 'nota' }, t('Skills are reusable instructions (a folder with SKILL.md) that every agent can use. Agents see the name and description of active skills and read the full content when needed; you can force one with /skill <name>.')),
    h('p', { class: 'nota aviso-privacidade' }, t('Skills are third-party instructions: review the content before enabling. Skills never run code by themselves.')),
    h('div', { class: 'linha' },
      h('button', { class: 'btn', type: 'button', onclick: () => enviar({ tipo: 'importarSkill', origem: 'pasta' }) }, t('Import folder')),
      h('button', { class: 'btn', type: 'button', onclick: () => enviar({ tipo: 'importarSkill', origem: 'zip' }) }, t('Import .zip'))),
    h('div', { class: 'linha' }, github,
      h('button', { class: 'btn', type: 'button', onclick: () => { if (/^https:\/\/github\.com\//i.test(urlGithub.trim())) enviar({ tipo: 'importarSkill', origem: 'github', url: urlGithub.trim() }); else ctx?.avisar(t('Enter a github.com address.')); } }, t('Import from GitHub'))),
    skillAberta
      ? h('section', { class: 'grupo-chats' },
        h('div', { class: 'linha' }, h('h3', {}, skillAberta.nome), botaoIcone('fechar', t('Close'), () => { skillAberta = null; ctx?.renderTudo(); })),
        h('pre', { class: 'detalhe skill-conteudo' }, skillAberta.conteudo))
      : null,
    skills.length ? h('ul', { class: 'lista-memorias' }, ...skills.map(itemSkill)) : h('p', { class: 'nota' }, t('No skills yet.')));
}

// ---------------------------------------------------------------- view
export function vistaIntegracoes(): HTMLElement {
  const botaoAba = (id: AbaIntegracoes, rotulo: string) => h('button', {
    class: `aba ${aba === id ? 'sel' : ''}`, type: 'button', role: 'tab', 'aria-selected': aba === id ? 'true' : 'false',
    onclick: () => { abrirIntegracoes(id); ctx?.renderTudo(); },
  }, rotulo);
  const conectadas = integracoes.filter((i) => i.estado === 'conectada' && i.ativa).length;
  const ativas = skills.filter((s) => s.ativa).length;
  return h('div', { class: 'pagina' },
    h('div', { class: 'pagina-topo' }, botaoIcone('voltar', t('Back to chat'), () => ctx?.voltar()), h('h2', {}, t('Integrations'))),
    h('div', { class: 'abas', role: 'tablist' },
      botaoAba('integracoes', `${t('Integrations')}${conectadas ? ` (${conectadas})` : ''}`),
      botaoAba('skills', `${t('Skills')}${ativas ? ` (${ativas})` : ''}`)),
    aba === 'integracoes' ? abaIntegracoes() : abaSkills());
}
