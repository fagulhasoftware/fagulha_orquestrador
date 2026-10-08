import { validarArgumentos } from './ferramentas';
import { diagnosticos, codigoSeguro, type CodigoDiagnostico } from './diagnostico';

export class FalhaPonte extends Error {
  constructor(readonly codigo: CodigoDiagnostico) {
    super(diagnosticos[codigo]);
  }
}

export async function chamarPonte(
  nome: string,
  entrada: unknown,
  env = process.env,
): Promise<unknown> {
  let args: Record<string, unknown>;
  try {
    args = validarArgumentos(nome, entrada);
  } catch {
    throw new FalhaPonte('argumentos_invalidos');
  }
  const url = env.ORQUESTRA_BRIDGE_URL,
    token = env.ORQUESTRA_BRIDGE_TOKEN;
  if (!url || !token) throw new FalhaPonte('variaveis_ausentes');
  try {
    const destino = new URL(url);
    if (
      destino.protocol !== 'http:' ||
      destino.hostname !== '127.0.0.1' ||
      destino.username ||
      destino.password ||
      destino.search ||
      destino.hash
    )
      throw new Error();
  } catch {
    throw new FalhaPonte('endereco_invalido');
  }
  let resposta: Response;
  try {
    resposta = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ nome, args }),
      signal: AbortSignal.timeout(nome === 'perguntar_usuario' ? 1860000 : 180_000),
      redirect: 'error',
    });
  } catch (e) {
    throw new FalhaPonte(
      (e as Error).name === 'TimeoutError' ? 'tempo_esgotado' : 'ponte_indisponivel',
    );
  }
  if (resposta.status === 401) throw new FalhaPonte('token_recusado');
  let dados: { resultado?: unknown; codigo?: unknown };
  try {
    dados = await resposta.json();
  } catch {
    throw new FalhaPonte('ponte_indisponivel');
  }
  if (!resposta.ok)
    throw new FalhaPonte(
      codigoSeguro(dados?.codigo) ??
        (resposta.status === 408 ? 'tempo_esgotado' : 'ferramenta_falhou'),
    );
  if (!dados || !Object.hasOwn(dados, 'resultado')) throw new FalhaPonte('ponte_indisponivel');
  return dados.resultado;
}
