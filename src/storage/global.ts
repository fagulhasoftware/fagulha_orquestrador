import type { Database } from 'sql.js';
import type { Agente, Configuracao } from '../shared/protocolo';
import type { ConfiguracaoVoz } from '../voice/configuracao';
export interface ConfigGlobal {
  configuracao?: Configuracao;
  primeiraExecucao: boolean;
  agentes: Record<string, Pick<Agente, 'habilitado' | 'papel' | 'modo'>>;
  voz?: ConfiguracaoVoz;
  revisao: string;
}
export function migrarGlobal(db: Database): void {
  if (db.exec('SELECT versao FROM migrations WHERE versao=3').length) return;
  const registros = (db.exec('SELECT dados FROM salas ORDER BY quando,id')[0]?.values ?? []).map(
    ([d]) => JSON.parse(String(d)),
  );
  const ultima = registros.filter((r) => r.configuracao).at(-1);
  const global: ConfigGlobal = {
    configuracao: ultima?.configuracao,
    primeiraExecucao: !registros.some((r) => r.primeiraExecucao === false),
    agentes: {},
    revisao: 'migracao-3',
  };
  for (const [id, dados] of db.exec('SELECT id,dados FROM provedores ORDER BY quando,id')[0]
    ?.values ?? []) {
    const a = JSON.parse(String(dados));
    global.agentes[String(id)] = { habilitado: a.habilitado, papel: a.papel, modo: a.modo };
  }
  db.run('INSERT OR IGNORE INTO globais (id,sala,quando,dados) VALUES (?,?,?,?)', [
    'configuracao',
    '',
    new Date().toISOString(),
    JSON.stringify(global),
  ]);
  db.run('INSERT INTO migrations VALUES (3)');
}
