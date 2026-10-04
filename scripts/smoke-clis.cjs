const { ProvedorCli, montarArgumentos } = require('../test/.tmp/build/src/providers/cli.js');

async function main() {
  console.log('Smoke sem prompts, sem chamadas a modelos e sem leitura de credenciais.');
  for (const id of ['claude', 'codex', 'gemini']) {
    const provedor = new ProvedorCli(id, async () => {});
    const deteccao = await provedor.detectar();
    const login = deteccao.instalado ? await provedor.estadoLogin() : 'indisponivel';
    console.log(
      `${id}: instalado=${deteccao.instalado}; versao=${deteccao.versao ?? '-'}; login=${login}`,
    );
    if (id === 'gemini')
      console.log(
        'Gemini: nao oferece comando oficial de status; login desconhecido, nenhum arquivo de autenticacao foi aberto.',
      );
    for (const nivel of ['manual', 'parcial', 'total']) {
      for (const modo of ['leitura', 'leitura_escrita', 'escrita']) {
        console.log(`${id} ${nivel} ${modo}: ${JSON.stringify(montarArgumentos(id, modo, nivel))}`);
      }
    }
  }
  console.log(
    'Codex: os overrides enabled=false dos MCPs herdados sao calculados antes da execucao, via mcp list; esta verificacao nao e executada pelo smoke.',
  );
}
main().catch(() => {
  console.error('Smoke falhou; detalhes sensiveis nao sao registrados.');
  process.exitCode = 1;
});
