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
import { AcaoRecusada } from '../permissions/portao';
export type ApiId = 'ollama' | 'openai-api' | 'openai-compativel' | 'anthropic' | 'gemini-api';
export interface OpcoesApi {
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
      id === 'gemini-api'
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
          : this.id === 'gemini-api'
            ? 'https://generativelanguage.googleapis.com/v1beta'
            : 'https://api.openai.com/v1')
    );
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
    const modelo = this.opcoes().modelo;
    if (!modelo) throw new Error(`Configure fagulha.provedores.${this.id}.modelo no VS Code.`);
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
          p.imagens?.length && (this.id === 'openai-compativel' || this.id === 'openai-api')
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
        await resposta.body?.cancel();
        throw new Error(`API ${this.id}: HTTP ${resposta.status}.`);
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
