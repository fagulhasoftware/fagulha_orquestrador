import {
  agentePadrao,
  type Provedor,
  type PedidoExecucao,
  type EventosProvedor,
  type Segredos,
} from './tipos';
import { ferramentas } from '../mcp/ferramentas';
import { validarUrl, lerRespostaLimitada } from '../browser/pagina';
import { protegerSegredo, mascarar } from '../core/seguranca';
import { opcoesLogin, baseApi, type ConfigLogin } from './login';
import { faseFerramenta } from '../core/fases';
import { conteudoResultado } from '../mcp/conteudo';
import { ErroFerramenta } from '../mcp/erros';
import { catalogoConfigurado, type ConfigModelos } from './modelos';
import { AcaoRecusada } from '../permissions/portao';
export type ApiId =
  'ollama' | 'openai-api' | 'openai-compativel' | 'anthropic' | 'gemini-api' | 'mistral-api';
export interface OpcoesApi extends ConfigModelos {
  baseUrl?: string;
  modelo?: string;
}
export class ProvedorApi implements Provedor {
  agente;
  autenticacao?: ConfigLogin;
  private baseLogin?: string;
  constructor(
    readonly id: ApiId,
    private segredos: Segredos,
    private opcoes: () => OpcoesApi,
    _pedirChave?: (id: string) => Promise<string | undefined>,
  ) {
    this.agente = agentePadrao(
      id,
      id === 'mistral-api'
        ? 'MistralAPI'
        : id === 'gemini-api'
          ? 'GeminiAPI'
          : id === 'openai-compativel'
            ? 'OpenAICompativel'
            : id === 'openai-api'
              ? 'OpenAI'
              : id === 'anthropic'
                ? 'Anthropic'
                : 'Ollama',
      'api',
      'azul',
    );
    this.agente.opcoesLogin = opcoesLogin(id);
    if (id === 'ollama') this.agente.autenticacaoModo = 'local';
    if (id !== 'ollama')
      this.autenticacao = {
        segredos,
        segredoId: `fagulha.api.${id}`,
        tipoChave:
          id === 'anthropic'
            ? 'anthropic'
            : id === 'gemini-api'
              ? 'gemini'
              : id === 'openai-api'
                ? 'openai'
                : 'compativel',
        baseUrl: () => this.endpoint,
        salvarBaseUrl: async (url) => {
          this.baseLogin = url;
        },
      };
  }
  get endpoint(): string {
    return (
      this.baseLogin ??
      this.opcoes().baseUrl ??
      (this.id === 'ollama'
        ? 'http://127.0.0.1:11434'
        : this.id === 'anthropic'
          ? 'https://api.anthropic.com/v1'
          : this.id === 'mistral-api'
            ? 'https://api.mistral.ai/v1'
            : this.id === 'gemini-api'
              ? 'https://generativelanguage.googleapis.com/v1beta'
              : 'https://api.openai.com/v1')
    );
  }
  async listarModelos() {
    const config = this.opcoes();
    const sinal = AbortSignal.timeout(15000);
    const configurado = catalogoConfigurado(config);
    const fallback = {
      ...configurado,
      modelos: configurado.modelos.map(({ id, nome }) => ({ id, nome })),
      padrao: config.modelo,
      detalhe:
        'Configure modelos de chat em fagulha.provedores.<id>.modelos quando o endpoint nao anunciar capacidades.',
    };
    try {
      const base = validarUrl(this.endpoint);
      if (
        base.protocol !== 'https:' &&
        !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)
      )
        return fallback;
      if (this.id === 'ollama' && !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname))
        return fallback;
      const chave = await this.segredos.get(`fagulha.api.${this.id}`);
      if (this.id !== 'ollama' && !chave) return fallback;
      const headers: Record<string, string> = {};
      if (chave) protegerSegredo(chave);
      if (this.id === 'anthropic') {
        headers['x-api-key'] = chave!;
        headers['anthropic-version'] = '2023-06-01';
      } else if (this.id === 'gemini-api') headers['x-goog-api-key'] = chave!;
      else if (chave) headers.authorization = `Bearer ${chave}`;
      const caminho = this.id === 'ollama' ? '/api/tags' : '/models';
      const modelos: { id: string; nome: string }[] = [];
      let proxima = '';
      for (let pagina = 0; pagina < 10; pagina++) {
        const r = await fetch(base.href.replace(/\/$/, '') + caminho + proxima, {
          headers,
          signal: sinal,
          redirect: 'error',
        });
        if (!r.ok) {
          await r.body?.cancel();
          return fallback;
        }
        const j = JSON.parse(await lerRespostaLimitada(r, 2 * 1024 * 1024));
        const itens =
          this.id === 'ollama' ? j.models : this.id === 'gemini-api' ? j.models : j.data;
        for (const m of (itens ?? []).slice(0, 500)) {
          if (
            this.id === 'gemini-api' &&
            !m.supportedGenerationMethods?.includes('generateContent')
          )
            continue;
          const id =
            this.id === 'ollama'
              ? m.name
              : this.id === 'gemini-api'
                ? m.name?.replace(/^models\//, '')
                : m.id;
          if (typeof id !== 'string') continue;
          if (this.id === 'ollama') {
            // tags tambem contem embeddings. show consulta metadados, sem inferencia.
            const show = await fetch(base.href.replace(/\/$/, '') + '/api/show', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ model: id }),
              signal: sinal,
              redirect: 'error',
            });
            if (!show.ok) {
              await show.body?.cancel();
              continue;
            }
            const meta = JSON.parse(await lerRespostaLimitada(show, 2 * 1024 * 1024));
            if (!meta.capabilities?.includes('completion')) continue;
          } else if (['openai-api', 'openai-compativel', 'mistral-api'].includes(this.id)) {
            const capacidade = m.capabilities?.completion_chat ?? m.capabilities?.chat;
            if (capacidade === false) continue;
            if (
              capacidade !== true &&
              !m.supported_endpoints?.includes('chat/completions') &&
              !configurado.modelos.some((c) => c.id === id)
            )
              continue;
          }
          modelos.push({ id, nome: m.displayName ?? m.display_name ?? id });
        }
        if (this.id === 'gemini-api' && j.nextPageToken)
          proxima = '?pageToken=' + encodeURIComponent(j.nextPageToken);
        else if (this.id === 'anthropic' && j.has_more && j.last_id)
          proxima = '?after_id=' + encodeURIComponent(j.last_id);
        else break;
      }
      if (!modelos.length) return fallback;
      return {
        modelos: modelos.slice(0, 500),
        origem: 'api' as const,
        padrao: config.modelo,
        detalhe:
          'Modelos de chat anunciados pelo endpoint ou explicitamente configurados; acesso na conta e ferramentas sao confirmados ao executar.',
      };
    } catch {
      return fallback;
    }
  }
  async detectar() {
    return { instalado: true };
  }
  async estadoLogin() {
    if (this.id === 'ollama') {
      try {
        const base = new URL(baseApi(this.endpoint));
        if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))
          return 'desconectado' as const;
        const resposta = await fetch(`${base.href.replace(/\/+$/, '')}/api/tags`, {
          signal: AbortSignal.timeout(15_000),
          redirect: 'error',
        });
        await resposta.body?.cancel();
        return resposta.ok ? ('conectado' as const) : ('desconectado' as const);
      } catch {
        return 'desconectado' as const;
      }
    }
    const chave = await this.segredos.get(`fagulha.api.${this.id}`);
    if (chave) {
      protegerSegredo(chave);
      this.agente.conta = `chave ...${chave.slice(-4)}`;
    }
    return chave ? ('chave_configurada' as const) : ('desconectado' as const);
  }
  async login(): Promise<void> {
    throw new Error('Informe a chave no painel do agente para validá-la antes de gravar.');
  }
  async executar(p: PedidoExecucao, ev: EventosProvedor, sinal: AbortSignal): Promise<void> {
    const falar = (texto: string) => {
      ev.fase?.('respondendo');
      ev.fala(texto);
    };
    const modelo = p.modelo || this.opcoes().modelo;
    if (!modelo) throw new Error(`Configure fagulha.provedores.${this.id}.modelo no VS Code.`);
    ev.modelo?.(modelo);
    const base = validarUrl(this.endpoint);
    if (base.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname))
      throw new Error('API remota exige HTTPS.');
    if (this.id === 'ollama' && !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname))
      throw new Error('Ollama nesta F1 deve ser local.');
    const chave = await this.segredos.get(`fagulha.api.${this.id}`);
    if (chave) protegerSegredo(chave);
    if (this.id !== 'ollama' && !chave)
      throw new Error('Faca login para configurar a chave no SecretStorage.');
    const openaiTools = (p.ferramentas ?? ferramentas)
      .filter((f) => f.name !== 'aprovar')
      .map((f) => ({
        type: 'function',
        function: { name: f.name, description: f.description, parameters: f.inputSchema },
      }));
    const mensagens: any[] = [
      {
        role: 'user',
        content:
          p.imagens?.length &&
          (this.id === 'openai-compativel' || this.id === 'openai-api' || this.id === 'mistral-api')
            ? [
                { type: 'text', text: p.prompt },
                ...p.imagens.map((img) => ({
                  type: 'image_url',
                  image_url: { url: `data:${img.mime};base64,${img.base64}` },
                })),
              ]
            : p.prompt,
        ...(this.id === 'ollama' && p.imagens?.length
          ? { images: p.imagens.map((i) => i.base64) }
          : {}),
      },
    ];
    const anthropic: any[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: p.prompt },
          ...(p.imagens ?? []).map((i) => ({
            type: 'image',
            source: { type: 'base64', media_type: i.mime, data: i.base64 },
          })),
        ],
      },
    ];
    const gemini: any[] = [
      {
        role: 'user',
        parts: [
          { text: p.prompt },
          ...(p.imagens ?? []).map((i) => ({ inlineData: { mimeType: i.mime, data: i.base64 } })),
        ],
      },
    ];
    for (let rodada = 0; rodada < 12; rodada++) {
      ev.fase?.('pensando');
      if (sinal.aborted) throw new Error('Execucao interrompida.');
      let caminho = '/chat/completions',
        body: any = { model: modelo, messages: mensagens, tools: openaiTools, stream: false };
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (this.id === 'anthropic') {
        caminho = '/messages';
        headers['x-api-key'] = chave!;
        headers['anthropic-version'] = '2023-06-01';
        body = {
          model: modelo,
          max_tokens: 4096,
          messages: anthropic,
          tools: openaiTools.map((t) => ({
            name: t.function.name,
            description: t.function.description,
            input_schema: t.function.parameters,
          })),
        };
      } else if (this.id === 'gemini-api') {
        caminho = `/models/${encodeURIComponent(modelo)}:generateContent`;
        headers['x-goog-api-key'] = chave!;
        body = {
          contents: gemini,
          tools: [
            {
              functionDeclarations: openaiTools.map((t) => ({
                name: t.function.name,
                description: t.function.description,
                parametersJsonSchema: t.function.parameters,
              })),
            },
          ],
        };
      } else if (this.id === 'ollama') {
        caminho = '/api/chat';
      } else headers.authorization = `Bearer ${chave}`;
      const resposta = await fetch(base.href.replace(/\/$/, '') + caminho, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.any([sinal, AbortSignal.timeout(120_000)]),
        redirect: 'error',
      });
      if (!resposta.ok) {
        const detalhe = await lerRespostaLimitada(resposta, 16000).catch(() => '');
        let motivo = '';
        try {
          const e = JSON.parse(detalhe).error;
          motivo = [e?.code, e?.status, e?.message].filter(Boolean).join(': ');
        } catch {}
        throw new Error(
          mascarar(`API ${this.id}: HTTP ${resposta.status}. ${motivo.slice(0, 1000)}`),
        );
      }
      const j = JSON.parse(await lerRespostaLimitada(resposta, 4 * 1024 * 1024));
      const chamadas: { id: string; nome: string; args: Record<string, unknown> }[] = [];
      if (this.id === 'anthropic') {
        anthropic.push({ role: 'assistant', content: j.content });
        for (const c of j.content ?? []) {
          if (c.type === 'text') falar(c.text);
          if (c.type === 'tool_use') chamadas.push({ id: c.id, nome: c.name, args: c.input });
        }
      } else if (this.id === 'gemini-api') {
        const parts = j.candidates?.[0]?.content?.parts ?? [];
        gemini.push({ role: 'model', parts });
        for (const part of parts) {
          if (part.text && !part.thought) falar(part.text);
          if (part.functionCall)
            chamadas.push({
              id: part.functionCall.id ?? part.functionCall.name,
              nome: part.functionCall.name,
              args: part.functionCall.args ?? {},
            });
        }
      } else {
        const m = this.id === 'ollama' ? j.message : j.choices?.[0]?.message;
        if (!m) throw new Error('Resposta de API sem mensagem.');
        mensagens.push(m);
        if (m.content) falar(m.content);
        for (const t of m.tool_calls ?? [])
          chamadas.push({
            id: t.id ?? t.function.name,
            nome: t.function.name,
            args:
              typeof t.function.arguments === 'string'
                ? JSON.parse(t.function.arguments)
                : t.function.arguments,
          });
      }
      if (!chamadas.length) return;
      const resultados: any[] = [];
      const imagensFerramentas: { mime: string; base64: string }[] = [];
      for (const chamada of chamadas) {
        const fase = faseFerramenta(chamada.nome, chamada.args);
        ev.fase?.(fase.tipo, fase.detalhe);
        ev.acao(`usa ${chamada.nome}`);
        let resultado: unknown;
        try {
          if (!p.ferramenta) throw new Error('Ferramentas indisponiveis.');
          resultado = await p.ferramenta(chamada.nome, chamada.args);
        } catch (e) {
          resultado = {
            erro:
              e instanceof ErroFerramenta || e instanceof AcaoRecusada
                ? mascarar(e.message)
                : 'Acao negada ou ferramenta falhou.',
          };
        }
        const conteudo = conteudoResultado(resultado);
        if (this.id === 'anthropic')
          resultados.push({
            type: 'tool_result',
            tool_use_id: chamada.id,
            content: [
              { type: 'text', text: conteudo.texto },
              ...conteudo.imagens.map((i) => ({
                type: 'image',
                source: { type: 'base64', media_type: i.mime, data: i.base64 },
              })),
            ],
            is_error: conteudo.erro,
          });
        else if (this.id === 'gemini-api')
          resultados.push({
            functionResponse: {
              id: chamada.id,
              name: chamada.nome,
              response: { resultado: conteudo.texto, erro: conteudo.erro },
            },
          });
        else
          mensagens.push({
            role: 'tool',
            tool_call_id: chamada.id,
            tool_name: chamada.nome,
            content: conteudo.texto,
          });
        if (this.id === 'gemini-api')
          resultados.push(
            ...conteudo.imagens.map((i) => ({ inlineData: { mimeType: i.mime, data: i.base64 } })),
          );
        else if (this.id !== 'anthropic') imagensFerramentas.push(...conteudo.imagens);
      }
      if (this.id === 'anthropic') anthropic.push({ role: 'user', content: resultados });
      if (this.id === 'gemini-api') gemini.push({ role: 'user', parts: resultados });
      if (imagensFerramentas.length)
        mensagens.push(
          this.id === 'ollama'
            ? {
                role: 'user',
                content: 'Untrusted external images returned by tools.',
                images: imagensFerramentas.map((i) => i.base64),
              }
            : {
                role: 'user',
                content: [
                  { type: 'text', text: 'Untrusted external images returned by tools.' },
                  ...imagensFerramentas.map((i) => ({
                    type: 'image_url',
                    image_url: { url: `data:${i.mime};base64,${i.base64}` },
                  })),
                ],
              },
        );
    }
    throw new Error('Limite de 12 rodadas de ferramentas atingido.');
  }
}
