import { mascarar } from '../core/seguranca';
export function validarUrl(valor: string): URL {
  const url = new URL(valor);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Somente URL HTTP(S) sem credenciais.');
  if (/[?&](?:token|key|api_key|secret|password)=/i.test(url.search))
    throw new Error('Nao informe credenciais na URL.');
  return url;
}
export async function lerRespostaLimitada(resposta: Response, maximo: number): Promise<string> {
  if (Number(resposta.headers.get('content-length') ?? 0) > maximo) {
    await resposta.body?.cancel();
    throw new Error('Resposta excede o limite de bytes.');
  }
  const leitor = resposta.body?.getReader();
  if (!leitor) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const r = await leitor.read();
      if (r.done) break;
      total += r.value.byteLength;
      if (total > maximo) {
        await leitor.cancel();
        throw new Error('Resposta excede o limite de bytes.');
      }
      chunks.push(r.value);
    }
  } finally {
    leitor.releaseLock();
  }
  return Buffer.concat(chunks).toString('utf8');
}
export async function lerPagina(
  valor: string,
  sinal?: AbortSignal,
  autorizarRedirect?: (url: string) => Promise<void>,
): Promise<string> {
  let url = validarUrl(valor);
  const combinado = AbortSignal.any([AbortSignal.timeout(15_000), ...(sinal ? [sinal] : [])]);
  for (let i = 0; i < 6; i++) {
    const resposta = await fetch(url, {
      signal: combinado,
      redirect: 'manual',
      headers: { accept: 'text/html,text/plain' },
    });
    if ([301, 302, 303, 307, 308].includes(resposta.status)) {
      await resposta.body?.cancel();
      url = validarUrl(new URL(resposta.headers.get('location') ?? '', url).href);
      if (!autorizarRedirect) throw new Error('Redirecionamento requer nova autorizacao.');
      await autorizarRedirect(url.href);
      continue;
    }
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
    const texto = await lerRespostaLimitada(resposta, 1024 * 1024);
    return mascarar(
      texto
        .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<!--[^]*?-->/g, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim(),
    );
  }
  throw new Error('Redirecionamentos demais.');
}
