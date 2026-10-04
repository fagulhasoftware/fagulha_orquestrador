import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import type { Mensagem, ResumoChat } from '../shared/protocolo';
import { Armazenamento } from '../storage/sqlite';
import {
  criarRegistroChat,
  mesmoProjeto,
  normalizarBusca,
  resumoChat,
  trechoMensagem,
  type ChatPersistido,
} from '../storage/chats';
import { mascarar } from './seguranca';

export class Chats {
  constructor(
    private storage: Armazenamento,
    readonly sala: string,
    readonly projeto: string | null,
  ) {}
  async obter(id: string): Promise<ChatPersistido> {
    const chat = await this.storage.obter<ChatPersistido>('chats', '', id);
    if (!chat) throw new Error('Chat nao encontrado ou excluido por outra janela.');
    return chat;
  }
  async criar(usuario: string): Promise<ChatPersistido> {
    const chat = criarRegistroChat(randomUUID(), this.projeto, usuario);
    await this.storage.criarChat(chat);
    return chat;
  }
  async inicial(usuario: string): Promise<ChatPersistido> {
    const sala = await this.storage.obter<{ ultimo_chat?: string }>('salas', this.sala, this.sala);
    if (sala?.ultimo_chat) {
      const ultimo = await this.storage.obter<ChatPersistido>('chats', '', sala.ultimo_chat);
      if (ultimo) return this.recuperarProjeto(ultimo);
    }
    const todos = await this.storage.listar<ChatPersistido>('chats', '');
    const candidato = todos
      .filter(
        (c) =>
          c.salaLegada === this.sala ||
          (mesmoProjeto(c.projeto, this.projeto) &&
            !(c.projeto === null && c.salaLegada && c.salaLegada !== 'avulsa')),
      )
      .sort((a, b) => b.atualizadoEm.localeCompare(a.atualizadoEm) || b.id.localeCompare(a.id))[0];
    return candidato ? this.recuperarProjeto(candidato) : this.criar(usuario);
  }
  private async recuperarProjeto(chat: ChatPersistido): Promise<ChatPersistido> {
    if (chat.salaLegada === this.sala && chat.projeto === null && this.projeto)
      return this.storage.atualizarChat(chat.id, {
        projeto: this.projeto,
        projetoNome: basename(this.projeto),
      });
    return chat;
  }
  async listar(busca?: string): Promise<ResumoChat[]> {
    const consulta = normalizarBusca((busca ?? '').trim());
    const chats = (await this.storage.listar<ChatPersistido>('chats', '')).sort(
      (a, b) => Number(b.fixado) - Number(a.fixado) || b.atualizadoEm.localeCompare(a.atualizadoEm),
    );
    const resultados: ResumoChat[] = [];
    for (const chat of chats) {
      const resumo = resumoChat(chat, this.projeto);
      if (consulta) {
        const mensagens = await this.storage.listar<Mensagem>('mensagens', chat.id);
        const encontrada = mensagens.find((m) =>
          normalizarBusca(mascarar(m.texto)).includes(consulta),
        );
        if (!normalizarBusca(chat.titulo).includes(consulta) && !encontrada) continue;
        resumo.trecho = trechoMensagem(encontrada?.texto ?? chat.titulo, consulta);
      }
      resultados.push(resumo);
      if (consulta && resultados.length === 50) break;
    }
    return resultados;
  }
  async renomear(id: string, titulo: string): Promise<ChatPersistido> {
    if (!titulo.trim() || titulo.trim().length > 120)
      throw new Error('O titulo deve ter entre 1 e 120 caracteres.');
    return this.storage.atualizarChat(id, {
      titulo: mascarar(titulo.trim()),
      tituloDefinido: true,
      atualizadoEm: new Date().toISOString(),
    });
  }
  fixar(id: string, fixado: boolean): Promise<ChatPersistido> {
    return this.storage.atualizarChat(id, { fixado });
  }
}
