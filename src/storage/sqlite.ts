import initSqlJs, { type SqlJsStatic, type Database } from 'sql.js';
import { mkdir, readFile, writeFile, rename, open, unlink, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Mensagem } from '../shared/protocolo';
import { migrarChats, tabelasChat, type OrigemSala } from './migracoes';
import { type ChatPersistido, tituloMensagem } from './chats';

export const tabelas = [
  'salas',
  'mensagens',
  'acoes',
  'aprovacoes',
  'auditoria',
  'anexos',
  'provedores',
  'sessoes_provedor',
  'contextos',
  'chats',
  'memorias',
] as const;
export type Tabela = (typeof tabelas)[number];
export class Armazenamento {
  private sql!: SqlJsStatic;
  private serial: Promise<unknown> = Promise.resolve();
  constructor(
    readonly arquivo: string,
    private wasm?: string,
  ) {}
  async iniciar(origem?: OrigemSala): Promise<void> {
    await mkdir(dirname(this.arquivo), { recursive: true });
    this.sql = await initSqlJs(this.wasm ? { locateFile: () => this.wasm! } : {});
    await this.transacao((db) => {
      db.run('CREATE TABLE IF NOT EXISTS migrations (versao INTEGER PRIMARY KEY)');
      for (const tabela of tabelas) {
        db.run(
          `CREATE TABLE IF NOT EXISTS ${tabela} (id TEXT NOT NULL, sala TEXT NOT NULL, quando TEXT NOT NULL, dados TEXT NOT NULL, PRIMARY KEY(sala,id))`,
        );
        db.run(`CREATE INDEX IF NOT EXISTS idx_${tabela}_sala_quando ON ${tabela}(sala,quando,id)`);
      }
      db.run('INSERT OR IGNORE INTO migrations VALUES (1)');
      migrarChats(db, origem);
    });
  }
  private async carregar(): Promise<Database> {
    try {
      const db = new this.sql.Database(await readFile(this.arquivo));
      db.run('PRAGMA foreign_keys=ON');
      return db;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      const db = new this.sql.Database();
      db.run('PRAGMA foreign_keys=ON');
      return db;
    }
  }
  private async lock(): Promise<() => Promise<void>> {
    const arquivo = this.arquivo + '.lock';
    const inicio = Date.now();
    for (;;) {
      try {
        const handle = await open(arquivo, 'wx', 0o600);
        await handle.writeFile(JSON.stringify({ pid: process.pid, quando: Date.now() }));
        return async () => {
          await handle.close();
          await unlink(arquivo);
        };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
        // Somente recupera lock de processo morto; nunca rouba de writer ativo.
        try {
          const lock = JSON.parse(await readFile(arquivo, 'utf8')) as { pid: number };
          try {
            process.kill(lock.pid, 0);
          } catch (err) {
            if (
              (err as NodeJS.ErrnoException).code === 'ESRCH' &&
              (await stat(arquivo)).mtimeMs < inicio - 1000
            )
              await unlink(arquivo);
          }
        } catch {
          /* outro processo pode estar escrevendo o lock */
        }
        if (Date.now() - inicio > 10_000)
          throw new Error('SQLite ocupado por outra janela. Tente novamente.');
        await new Promise((r) => setTimeout(r, 30));
      }
    }
  }
  private transacao<T>(fn: (db: Database) => T): Promise<T> {
    const tarefa = this.serial.then(async () => {
      const liberar = await this.lock();
      let db: Database | undefined;
      const tmp = this.arquivo + '.' + randomUUID() + '.tmp';
      try {
        db = await this.carregar();
        db.run('BEGIN IMMEDIATE');
        const valor = fn(db);
        db.run('COMMIT');
        await writeFile(tmp, db.export(), { mode: 0o600 });
        await rename(tmp, this.arquivo);
        return valor;
      } finally {
        db?.close();
        await unlink(tmp).catch(() => {});
        await liberar();
      }
    });
    this.serial = tarefa.catch(() => {});
    return tarefa;
  }
  async gravar(tabela: Tabela, sala: string, id: string, dados: unknown): Promise<void> {
    await this.transacao((db) =>
      db.run(
        `INSERT INTO ${tabela} (id,sala,quando,dados${(tabelasChat as readonly string[]).includes(tabela) ? ',chat' : ''}) VALUES (?,?,?,?${(tabelasChat as readonly string[]).includes(tabela) ? ',(SELECT id FROM chats WHERE id=?)' : ''}) ON CONFLICT(sala,id) DO UPDATE SET quando=excluded.quando,dados=excluded.dados`,
        [
          id,
          sala,
          new Date().toISOString(),
          JSON.stringify(dados),
          ...((tabelasChat as readonly string[]).includes(tabela) ? [sala] : []),
        ],
      ),
    );
  }
  async criarChat(chat: ChatPersistido): Promise<void> {
    await this.gravar('chats', '', chat.id, chat);
  }
  async gravarDoChat(
    tabela: (typeof tabelasChat)[number],
    chat: string,
    id: string,
    dados: unknown,
  ): Promise<void> {
    await this.transacao((db) => {
      this.obterChat(db, chat);
      db.run(
        `INSERT INTO ${tabela} (id,sala,quando,dados,chat) VALUES (?,?,?,?,?) ON CONFLICT(sala,id) DO UPDATE SET quando=excluded.quando,dados=excluded.dados`,
        [id, chat, new Date().toISOString(), JSON.stringify(dados), chat],
      );
    });
  }
  private obterChat(db: Database, id: string): ChatPersistido {
    const d = db.exec('SELECT dados FROM chats WHERE id=?', [id])[0]?.values[0]?.[0];
    if (!d) throw new Error('Chat não encontrado ou excluído por outra janela.');
    return JSON.parse(String(d));
  }
  private escreverChat(db: Database, chat: ChatPersistido): void {
    db.run('UPDATE chats SET quando=?,dados=? WHERE id=?', [
      chat.atualizadoEm,
      JSON.stringify(chat),
      chat.id,
    ]);
  }
  async atualizarChat(id: string, parcial: Partial<ChatPersistido>): Promise<ChatPersistido> {
    return this.transacao((db) => {
      const chat = { ...this.obterChat(db, id), ...parcial, id };
      this.escreverChat(db, chat);
      return chat;
    });
  }
  async pendentesChat(id: string, adicionar: string[], remover: string[]): Promise<void> {
    await this.transacao((db) => {
      const chat = this.obterChat(db, id);
      chat.anexosPendentes = [...new Set([...chat.anexosPendentes, ...adicionar])].filter(
        (i) => !remover.includes(i),
      );
      this.escreverChat(db, chat);
    });
  }
  async gravarMensagem(
    chatId: string,
    mensagem: Mensagem,
    usuario: boolean,
  ): Promise<ChatPersistido> {
    return this.transacao((db) => {
      const chat = this.obterChat(db, chatId);
      const quando = new Date().toISOString();
      for (const tabela of mensagem.tipo === 'acao' ? ['mensagens', 'acoes'] : ['mensagens'])
        db.run(
          `INSERT INTO ${tabela} (id,sala,quando,dados,chat) VALUES (?,?,?,?,?) ON CONFLICT(sala,id) DO UPDATE SET quando=excluded.quando,dados=excluded.dados`,
          [mensagem.id, chatId, quando, JSON.stringify(mensagem), chatId],
        );
      if (usuario) {
        if (!chat.usuarios.includes(mensagem.autor)) chat.usuarios.push(mensagem.autor);
        if (!chat.tituloDefinido) {
          chat.titulo = tituloMensagem(mensagem.texto, mensagem.quando);
          chat.tituloDefinido = true;
        }
      } else if (
        mensagem.tipo === 'fala' &&
        mensagem.autor !== 'sistema' &&
        !chat.usuarios.includes(mensagem.autor) &&
        !chat.agentes.includes(mensagem.autor)
      )
        chat.agentes.push(mensagem.autor);
      chat.mensagens = Number(
        db.exec('SELECT COUNT(*) FROM mensagens WHERE chat=?', [chatId])[0].values[0][0],
      );
      chat.atualizadoEm = quando > chat.atualizadoEm ? quando : chat.atualizadoEm;
      this.escreverChat(db, chat);
      return chat;
    });
  }
  async excluirChat(id: string): Promise<string[]> {
    return this.transacao((db) => {
      this.obterChat(db, id);
      const anexos = (db.exec('SELECT dados FROM anexos WHERE chat=?', [id])[0]?.values ?? []).map(
        ([d]) => JSON.parse(String(d)) as { arquivo?: string },
      );
      db.run('DELETE FROM chats WHERE id=?', [id]);
      for (const tabela of tabelasChat) db.run(`DELETE FROM ${tabela} WHERE sala=?`, [id]);
      for (const [sala, dados] of db.exec('SELECT sala,dados FROM salas')[0]?.values ?? []) {
        const d = JSON.parse(String(dados));
        if (d.ultimo_chat === id) {
          delete d.ultimo_chat;
          db.run('UPDATE salas SET dados=? WHERE sala=?', [JSON.stringify(d), String(sala)]);
        }
      }
      const referencias = new Set(
        (db.exec('SELECT dados FROM anexos')[0]?.values ?? []).map(
          ([d]) => JSON.parse(String(d)).arquivo,
        ),
      );
      return [
        ...new Set(
          anexos.map((a) => a.arquivo).filter((p): p is string => !!p && !referencias.has(p)),
        ),
      ];
    });
  }
  async resolverAprovacao(chat: string, id: string, decisao: string): Promise<boolean> {
    return this.transacao((db) => {
      const linha = db.exec('SELECT dados FROM aprovacoes WHERE chat=? AND id=?', [chat, id])[0]
        ?.values[0]?.[0];
      if (!linha) return false;
      const pedido = JSON.parse(String(linha));
      if (pedido.decisao) return false;
      db.run('UPDATE aprovacoes SET dados=? WHERE chat=? AND id=?', [
        JSON.stringify({ ...pedido, decisao }),
        chat,
        id,
      ]);
      return true;
    });
  }
  async remover(tabela: Tabela, sala: string, id: string): Promise<void> {
    await this.transacao((db) => db.run(`DELETE FROM ${tabela} WHERE sala=? AND id=?`, [sala, id]));
  }
  async listar<T>(tabela: Tabela, sala?: string): Promise<T[]> {
    await this.serial;
    const db = await this.carregar();
    try {
      const stmt = db.prepare(
        `SELECT dados FROM ${tabela}${sala !== undefined ? ' WHERE sala=?' : ''} ORDER BY quando,id`,
      );
      try {
        if (sala !== undefined) stmt.bind([sala]);
        const dados: T[] = [];
        while (stmt.step()) dados.push(JSON.parse(String(stmt.get()[0])) as T);
        return dados;
      } finally {
        stmt.free();
      }
    } finally {
      db.close();
    }
  }
  async obter<T>(tabela: Tabela, sala: string, id: string): Promise<T | undefined> {
    await this.serial;
    const db = await this.carregar();
    try {
      const s = db.prepare(`SELECT dados FROM ${tabela} WHERE sala=? AND id=?`);
      try {
        s.bind([sala, id]);
        return s.step() ? (JSON.parse(String(s.get()[0])) as T) : undefined;
      } finally {
        s.free();
      }
    } finally {
      db.close();
    }
  }
  async finalizar(): Promise<void> {
    await this.serial;
  }
}
