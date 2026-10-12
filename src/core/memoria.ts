import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import type { Memoria } from '../shared/protocolo';
import { Armazenamento } from '../storage/sqlite';
import { mesmoProjeto } from '../storage/chats';
import { mascarar } from './seguranca';

export function validarMemoria(texto: string): string {
  if (typeof texto !== 'string' || !texto.trim() || texto.length > 500)
    throw new Error('A memoria deve ter entre 1 e 500 caracteres.');
  if (mascarar(texto) !== texto || /(?:senha|segredo)\s*[:=]\s*\S+/i.test(texto))
    throw new Error(
      'A memoria parece conter uma chave, token ou senha. Remova o segredo antes de guardar.',
    );
  return texto.trim();
}

export function memoriasDoProjeto(lista: Memoria[], projeto: string | null): Memoria[] {
  return lista
    .filter(
      (m) =>
        m.ativa &&
        (m.escopo === 'global' || (projeto !== null && mesmoProjeto(m.projeto, projeto))),
    )
    .sort((a, b) => b.atualizadaEm.localeCompare(a.atualizadaEm) || b.id.localeCompare(a.id));
}

export function contextoMemorias(lista: Memoria[], projeto: string | null): string {
  let texto = 'Memoria do usuario (preferencias e decisoes persistentes)';
  for (const m of memoriasDoProjeto(lista, projeto)) {
    if (mascarar(m.texto) !== m.texto || /(?:senha|segredo)\s*[:=]\s*\S+/i.test(m.texto)) continue;
    const linha = `\n- [${m.escopo}] ${m.texto}`;
    if (texto.length + linha.length > 4000) continue;
    texto += linha;
  }
  return texto;
}

export class Memorias {
  constructor(
    private storage: Armazenamento,
    private projeto: string | null,
  ) {}
  listar(): Promise<Memoria[]> {
    return this.storage.listar('memorias', '');
  }
  async salvar(
    entrada: { id?: string; escopo: Memoria['escopo']; texto: string; ativa?: boolean },
    agente?: string,
  ): Promise<Memoria> {
    const texto = validarMemoria(entrada.texto);
    if (!['global', 'projeto'].includes(entrada.escopo))
      throw new Error('Escopo de memoria invalido.');
    const anterior = entrada.id
      ? await this.storage.obter<Memoria>('memorias', '', entrada.id)
      : undefined;
    if (entrada.id && !anterior) throw new Error('Memoria nao encontrada.');
    const projeto =
      entrada.escopo === 'global'
        ? null
        : anterior?.escopo === 'projeto'
          ? anterior.projeto
          : this.projeto;
    if (entrada.escopo === 'projeto' && !projeto)
      throw new Error('Abra uma pasta para guardar memoria de projeto ou escolha Global.');
    const agora = new Date().toISOString();
    const memoria: Memoria = {
      id: anterior?.id ?? randomUUID(),
      escopo: entrada.escopo,
      projeto,
      projetoNome: projeto ? basename(projeto) : null,
      texto,
      origem: agente ? 'agente' : 'usuario',
      ...(agente ? { agente } : {}),
      ativa: entrada.ativa ?? anterior?.ativa ?? true,
      criadaEm: anterior?.criadaEm ?? agora,
      atualizadaEm: agora,
    };
    await this.storage.gravar('memorias', '', memoria.id, memoria);
    return memoria;
  }
  async excluir(id: string): Promise<void> {
    await this.storage.remover('memorias', '', id);
  }
}
