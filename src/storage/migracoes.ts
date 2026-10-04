import type { Database } from 'sql.js';
import { randomUUID } from 'node:crypto';
import type { Mensagem } from '../shared/protocolo';
import { criarRegistroChat, tituloMensagem } from './chats';

export const tabelasChat = [
  'mensagens',
  'acoes',
  'anexos',
  'aprovacoes',
  'contextos',
  'sessoes_provedor',
] as const;
export interface OrigemSala {
  sala: string;
  projeto: string | null;
  titulo: string;
}
export function migrarChats(db: Database, origem?: OrigemSala): void {
  db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_chats_id ON chats(id)');
  for (const tabela of tabelasChat) {
    const colunas = db.exec(`PRAGMA table_info(${tabela})`)[0].values;
    if (!colunas.some((c) => c[1] === 'chat'))
      db.run(`ALTER TABLE ${tabela} ADD COLUMN chat TEXT REFERENCES chats(id) ON DELETE CASCADE`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_${tabela}_chat ON ${tabela}(chat,quando,id)`);
  }
  if (db.exec('SELECT versao FROM migrations WHERE versao=2').length) return;
  const salas =
    db.exec(
      `SELECT sala FROM salas UNION ${tabelasChat.map((t) => `SELECT sala FROM ${t}`).join(' UNION ')}`,
    )[0]?.values ?? [];
  for (const [valor] of salas) {
    const sala = String(valor);
    const registro = db.exec('SELECT dados FROM salas WHERE sala=? AND id=?', [sala, sala])[0]
      ?.values[0]?.[0];
    const persistida = registro ? JSON.parse(String(registro)) : {};
    const nick = persistida.configuracao?.nick ?? 'Voce';
    const mensagens = (
      db.exec('SELECT dados FROM mensagens WHERE sala=? ORDER BY quando,id', [sala])[0]?.values ??
      []
    ).map(([d]) => JSON.parse(String(d)) as Mensagem);
    const agentes = new Set(
      (db.exec('SELECT dados FROM provedores WHERE sala=?', [sala])[0]?.values ?? []).map(
        ([d]) => JSON.parse(String(d)).nick,
      ),
    );
    const usuario = mensagens.find(
      (m) =>
        m.tipo === 'fala' && (m.autor === nick || (m.autor !== 'sistema' && !agentes.has(m.autor))),
    );
    const projeto = persistida.projeto ?? (origem?.sala === sala ? origem.projeto : null);
    const quando = mensagens[0]?.quando ?? new Date().toISOString();
    const chat = criarRegistroChat(randomUUID(), projeto, nick, quando);
    chat.salaLegada = sala;
    chat.titulo = usuario ? tituloMensagem(usuario.texto, usuario.quando) : chat.titulo;
    chat.tituloDefinido = !!usuario;
    chat.mensagens = mensagens.length;
    chat.atualizadoEm = mensagens.at(-1)?.quando ?? quando;
    chat.usuarios = [...new Set([nick, ...(usuario ? [usuario.autor] : [])])];
    chat.agentes = [
      ...new Set(
        mensagens
          .filter(
            (m) => m.tipo === 'fala' && !chat.usuarios.includes(m.autor) && m.autor !== 'sistema',
          )
          .map((m) => m.autor),
      ),
    ];
    chat.anexosPendentes = persistida.anexosPendentes ?? [];
    db.run('INSERT INTO chats (id,sala,quando,dados) VALUES (?,?,?,?)', [
      chat.id,
      '',
      chat.atualizadoEm,
      JSON.stringify(chat),
    ]);
    for (const t of tabelasChat)
      db.run(`UPDATE ${t} SET sala=?,chat=? WHERE sala=?`, [chat.id, chat.id, sala]);
    const sessoes =
      db.exec('SELECT id,dados FROM sessoes_provedor WHERE chat=?', [chat.id])[0]?.values ?? [];
    for (const [id, dados] of sessoes) {
      const sessao = JSON.parse(String(dados));
      db.run('UPDATE sessoes_provedor SET id=? WHERE chat=? AND id=?', [
        `${id}:${sessao.modo ?? 'leitura_escrita'}`,
        chat.id,
        String(id),
      ]);
    }
    db.run(
      'INSERT INTO salas (id,sala,quando,dados) VALUES (?,?,?,?) ON CONFLICT(sala,id) DO UPDATE SET dados=excluded.dados',
      [sala, sala, quando, JSON.stringify({ ...persistida, projeto, ultimo_chat: chat.id })],
    );
  }
  db.run('INSERT INTO migrations VALUES (2)');
}
