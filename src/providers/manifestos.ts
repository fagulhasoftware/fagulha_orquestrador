import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { ProvedorApi, type OpcoesApi } from './api';
import {
  agentePadrao,
  type Provedor,
  type Segredos,
  type PedidoExecucao,
  type EventosProvedor,
} from './tipos';
import { rodar } from './processo';
import { mascarar } from '../core/seguranca';
const schema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_-]{1,60}$/),
    nick: z.string().min(1).max(80),
    tipo: z.enum(['cli-generico', 'openai-compativel']),
    comando: z.string().max(2048).optional(),
    argumentos: z.array(z.string().max(2048)).max(100).optional(),
    saida: z.enum(['texto', 'jsonl']).default('texto'),
    campos: z
      .object({ texto: z.string(), sessao: z.string().optional(), acao: z.string().optional() })
      .strict()
      .optional(),
    suportaImagem: z.boolean().default(false),
    baseUrl: z.string().url().optional(),
    modelo: z.string().max(200).optional(),
    login: z.array(z.string().max(2048)).max(20).optional(),
  })
  .strict();
export type Manifesto = z.infer<typeof schema>;
export function validarManifesto(valor: unknown): Manifesto {
  const m = schema.parse(valor);
  if (m.tipo === 'cli-generico' && !m.comando) throw new Error('Manifesto CLI requer comando.');
  if (m.tipo === 'openai-compativel' && !m.baseUrl)
    throw new Error('Manifesto API requer baseUrl.');
  if (JSON.stringify(m) !== mascarar(JSON.stringify(m)))
    throw new Error('Manifesto nao pode conter segredos.');
  return m;
}
function campo(j: any, caminho: string | undefined): unknown {
  return caminho?.split('.').reduce((v, k) => v?.[k], j);
}
export class CliGenerico implements Provedor {
  agente;
  constructor(
    private m: Manifesto,
    _terminal: (cmd: string, args: string[]) => Promise<void>,
    private opcoes: () => OpcoesApi & { comando?: string } = () => ({}),
  ) {
    this.agente = agentePadrao(m.id, m.nick, 'cli', 'laranja');
    this.agente.origem = 'manifesto';
    this.agente.suportaImagem = false;
  }
  async detectar() {
    try {
      const versao = await rodar(this.opcoes().comando ?? this.m.comando!, ['--version'], {
        timeoutMs: 5000,
      });
      return { instalado: true, versao: versao.trim().slice(0, 100) };
    } catch {
      return { instalado: false };
    }
  }
  async estadoLogin() {
    return 'desconhecido' as const;
  }
  async login() {
    throw new Error('Este manifesto não oferece login por link. Nenhum terminal será aberto.');
  }
  async executar(p: PedidoExecucao, ev: EventosProvedor, sinal: AbortSignal): Promise<void> {
    const args = (this.m.argumentos ?? []).map((a) =>
      a
        .replaceAll('{prompt}', p.prompt)
        .replaceAll('{sessao}', p.sessao ?? '')
        .replaceAll('{modo}', p.nivel === 'manual' ? 'leitura' : p.modo),
    );
    const resultado = await rodar(this.opcoes().comando ?? this.m.comando!, args, {
      cwd: p.projeto,
      sinal,
      stdin: p.prompt,
      linha:
        this.m.saida === 'jsonl'
          ? (l) => {
              let j;
              try {
                j = JSON.parse(l);
              } catch {
                return;
              }
              const t = campo(j, this.m.campos?.texto),
                s = campo(j, this.m.campos?.sessao),
                a = campo(j, this.m.campos?.acao);
              if (typeof t === 'string') ev.fala(t);
              if (typeof s === 'string') ev.sessao(s);
              if (typeof a === 'string') ev.acao(a);
            }
          : undefined,
    });
    if (this.m.saida === 'texto') ev.fala(resultado);
  }
}
export async function lerManifesto(arquivo: string): Promise<Manifesto> {
  if ((await stat(arquivo)).size > 64 * 1024) throw new Error('Manifesto excede 64 KB.');
  return validarManifesto(JSON.parse(await readFile(arquivo, 'utf8')));
}
export function criarProvedorManifesto(
  m: Manifesto,
  segredos: Segredos,
  terminal: (cmd: string, args: string[]) => Promise<void>,
  pedirChave: (id: string) => Promise<string | undefined>,
  opcoes: () => OpcoesApi & { comando?: string } = () => ({}),
): Provedor {
  if (m.tipo === 'cli-generico') return new CliGenerico(m, terminal, opcoes);
  const secrets: Segredos = {
    get: () => segredos.get(`fagulha.api.${m.id}`),
    store: (_id, valor) => segredos.store(`fagulha.api.${m.id}`, valor),
    delete: () =>
      segredos.delete
        ? segredos.delete(`fagulha.api.${m.id}`)
        : Promise.reject(new Error('SecretStorage sem remoção.')),
  };
  const p = new ProvedorApi(
    'openai-compativel',
    secrets,
    () =>
      ({
        baseUrl: opcoes().baseUrl ?? m.baseUrl,
        modelo: opcoes().modelo ?? m.modelo,
      }) as OpcoesApi,
    () => pedirChave(m.id),
  );
  Object.assign(p.agente, {
    id: m.id,
    nick: m.nick,
    origem: 'manifesto',
    suportaImagem: m.suportaImagem,
  });
  return p;
}
export async function carregarManifestos(pasta: string): Promise<Manifesto[]> {
  let dirs;
  try {
    dirs = await readdir(pasta, { withFileTypes: true });
  } catch {
    return [];
  }
  const saida: Manifesto[] = [];
  for (const d of dirs) {
    if (!d.isDirectory() || d.isSymbolicLink()) continue;
    try {
      saida.push(await lerManifesto(join(pasta, d.name, 'orquestra-provedor.json')));
    } catch {
      /* manifesto invalido nao executa */
    }
  }
  return saida;
}
