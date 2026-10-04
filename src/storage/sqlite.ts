import initSqlJs, { type SqlJsStatic, type Database } from 'sql.js';
import { mkdir, readFile, writeFile, rename, open, unlink, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

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
] as const;
export type Tabela = (typeof tabelas)[number];
export class Armazenamento {
  private sql!: SqlJsStatic;
  private serial: Promise<unknown> = Promise.resolve();
  constructor(
    readonly arquivo: string,
    private wasm?: string,
  ) {}
  async iniciar(): Promise<void> {
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
    });
  }
  private async carregar(): Promise<Database> {
    try {
      return new this.sql.Database(await readFile(this.arquivo));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      return new this.sql.Database();
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
        `INSERT INTO ${tabela} VALUES (?,?,?,?) ON CONFLICT(sala,id) DO UPDATE SET quando=excluded.quando,dados=excluded.dados`,
        [id, sala, new Date().toISOString(), JSON.stringify(dados)],
      ),
    );
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
