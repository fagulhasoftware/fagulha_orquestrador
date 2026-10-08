import { test } from 'node:test';
import assert from 'node:assert/strict';
import { irreversivelExterno } from '../src/permissions/irreversivel';
import { montarArgumentos } from '../src/providers/cli';
import { isolamentoMcp } from '../src/providers/codex-mcp';
import { Portao } from '../src/permissions/portao';
import { configuracaoPadrao } from '../src/core/configuracao';

for (const comando of [
  'git push --force',
  'git push origin main -f',
  'git push --force-with-lease',
  'git push --delete origin main',
  'git push origin :main',
  'git -C repo push origin :main',
  'gh repo delete repo',
  'gh release delete v1',
  'gcloud projects delete projeto',
  'gcloud compute instances delete vm',
  'oci compute instance terminate --instance-id id',
  'aws ec2 terminate-instances --instance-ids id',
  'aws rds delete-db-instance --db-instance-identifier id',
  'aws s3 rb s3://bucket',
  'az group delete --name grupo',
  'terraform destroy',
  'terraform apply -destroy',
  'kubectl delete namespace ns',
  'kubectl delete cluster c',
  'kubectl delete pv volume',
  'supabase db reset',
  'supabase projects delete --project-ref ref',
  'psql -h db.example.com -c "DROP TABLE clientes"',
  'psql postgresql://db.example.com/base -c "TRUNCATE clientes"',
  'mysql --host=db.example.com -e "DELETE FROM clientes"',
  'psql -h db.example.com -c "DELETE FROM a; DELETE FROM b WHERE id=1"',
  'vercel remove app',
  'netlify sites:delete',
  'fly apps destroy app',
])
  test(`irreversivel: ${comando}`, () => assert.equal(irreversivelExterno(comando), true));

for (const comando of [
  'git push origin main',
  'git status',
  'npm run build',
  'echo teste',
  'Remove-Item arquivo.txt',
  'gh repo view repo',
  'aws s3 ls',
  'psql -h localhost -c "DROP TABLE teste"',
  'mysql -h 127.0.0.1 -e "TRUNCATE teste"',
  'psql postgresql://[::1]/base -c "DELETE FROM teste"',
  'psql -h db.example.com -c "DELETE FROM teste WHERE id=1"',
])
  test(`automatico: ${comando}`, () => assert.equal(irreversivelExterno(comando), false));

test('Codex Total preserva MCPs e aplica configuracao tambem em retomada', () => {
  const lista = [
    { nome: 'usuario', enabled: true, transporte: { command: 'node', args: [] } },
    { nome: 'desligado', enabled: false },
  ];
  assert.deepEqual(isolamentoMcp(lista, 'total'), { args: [], ativos: ['usuario'] });
  for (const sessao of [undefined, 'sessao']) {
    const args = montarArgumentos(
      'codex',
      'leitura_escrita',
      'total',
      sessao,
      undefined,
      undefined,
      undefined,
      lista,
    );
    assert(args.includes(sessao ? 'sandbox_mode="danger-full-access"' : 'danger-full-access'));
    assert(args.includes('features.shell_tool=false'));
    assert(args.includes('features.unified_exec=false'));
    assert(!args.includes('features.apply_patch_freeform=false'));
    assert(args.includes('web_search="live"'));
    assert(!args.some((a) => /enabled=false/.test(a)));
  }
});

test('Total executa comando comum e sobrescrita; nega irreversivel antes do efeito e audita', async () => {
  const config = configuracaoPadrao();
  config.nivel = 'total';
  const auditoria: any[] = [];
  let pedidos = 0;
  let efeitos = 0;
  const portao = new Portao(
    () => config,
    (e) => {
      if (e.tipo === 'aprovacao') {
        pedidos++;
        assert.equal(e.pedido.categoria, 'irreversivel_externo');
        assert.equal(e.pedido.critica, true);
        queueMicrotask(() => portao.responder(e.pedido.id, 'negar'));
      }
    },
    async (r) => {
      auditoria.push(r);
    },
  );
  const acao = {
    agente: 'codex',
    modo: 'leitura_escrita' as const,
    resumo: 'Teste',
    detalhe: 'teste',
    critica: true,
  };
  await portao.executar({ ...acao, categoria: 'comando' }, async () => efeitos++);
  await portao.executar({ ...acao, categoria: 'escrita_maquina' }, async () => efeitos++);
  await assert.rejects(
    portao.executar({ ...acao, categoria: 'irreversivel_externo' }, async () => efeitos++),
  );
  assert.equal(efeitos, 2);
  assert.equal(pedidos, 1);
  assert.deepEqual(
    auditoria.map((r) => r.decisao),
    ['automatica', 'automatica', 'negar'],
  );
});
