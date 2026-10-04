const { Open } = require('unzipper');
const { userInfo } = require('node:os');
const { mkdtemp, mkdir, writeFile, rm } = require('node:fs/promises');
const { resolve, join, sep, posix } = require('node:path');

// vsce normaliza LICENSE para LICENSE.txt no arquivo VSIX.
const documentos = new Set([
  'package.json',
  'readme.md',
  'license',
  'license.txt',
  'privacidade.md',
  'changelog.md',
]);
const midias = new Set(['logo.png', 'logo-barra.png', 'orquestra.css', 'orquestra.svg']);
const envelope = new Set(['[Content_Types].xml', 'extension.vsixmanifest']);

function usuarioAtual() {
  try {
    return userInfo().username;
  } catch {
    // Alguns sandboxes Windows bloqueiam uv_os_get_passwd. Continua verificando
    // o usuario do ambiente; jamais pula silenciosamente essa verificacao.
    const usuario = process.env.USERNAME || process.env.USER;
    if (!usuario)
      throw new Error('Nao foi possivel identificar o usuario para verificar privacidade.');
    return usuario;
  }
}
function escaparRegex(valor) {
  return valor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function temEmail(texto) {
  // Buscar @ primeiro evita backtracking quadratico em strings minificadas/base64.
  for (let indice = texto.indexOf('@'); indice >= 0; indice = texto.indexOf('@', indice + 1)) {
    const antes = texto.slice(Math.max(0, indice - 320), indice);
    const depois = texto.slice(indice + 1, indice + 321);
    if (
      /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(antes) &&
      /^[a-z0-9-]+(?:\.[a-z0-9-]+)+/i.test(depois)
    )
      return true;
  }
  return false;
}

function motivosConteudo(conteudo, usuario = usuarioAtual()) {
  const texto = Buffer.isBuffer(conteudo) ? conteudo.toString('utf8') : String(conteudo);
  const motivos = [];
  if (/[a-z]:(?:\\+|\/)Users(?:\\+|\/)[^\s"'<>\\/]+|\/(?:Users|home)\/[^\s"'<>/]+/i.test(texto))
    motivos.push('caminho de diretorio pessoal');
  if (usuario && new RegExp(escaparRegex(usuario), 'i').test(texto))
    motivos.push('usuario da maquina de empacotamento');
  if (/Nathan|natha|Talos|PontoCerto|fagulhasoftware@/i.test(texto))
    motivos.push('identificador pessoal ou de outro projeto');
  if (temEmail(texto)) motivos.push('endereco de e-mail');
  // Exige caracteres de chave depois do prefixo. Classes/escapes dos literais de
  // mascaramento (sk-[\w-], sk-ant-[\w-], AIza[\w-], gh[pousr]_) nao satisfazem isso.
  // Nenhum bloco de JS/regex e ignorado: chave real dentro de regex tambem reprova.
  if (/\b(?:sk-ant-|sk-(?!ant-)|AIza|gh[pousr]_)[a-z0-9][a-z0-9_-]*/i.test(texto))
    motivos.push('possivel chave ou token');
  return motivos;
}

function motivosArquivo(nome) {
  const caminho = nome.replaceAll('\\', '/');
  const partes = caminho.split('/');
  if (
    caminho.startsWith('/') ||
    /[:\x00-\x1f]/.test(caminho) ||
    partes.some((p) => p === '..' || p === '.' || /[. ]$/.test(p))
  )
    return ['caminho inseguro no arquivo ZIP'];
  const motivos = [];
  if (
    partes.some((p) => /^(?:orquestra|test|scripts|\.npm-cache|node_modules)$/i.test(p)) ||
    partes.some((p) => /^\.env/i.test(p) || /\.(?:sqlite(?:-.*)?|log|map)$/i.test(p))
  )
    motivos.push('arquivo de desenvolvimento, dados ou credenciais');
  const interno = caminho.startsWith('extension/') ? caminho.slice('extension/'.length) : '';
  if (
    !envelope.has(caminho) &&
    !documentos.has(interno.toLowerCase()) &&
    !(interno.startsWith('media/') && midias.has(interno.slice('media/'.length))) &&
    !interno.startsWith('dist/')
  )
    motivos.push('arquivo fora da lista de publicacao');
  return motivos;
}

async function verificarVsix(arquivo, { usuario = usuarioAtual() } = {}) {
  const zip = await Open.file(arquivo);
  const entradas = zip.files.filter((f) => f.type !== 'Directory');
  if (
    entradas.length > 5000 ||
    entradas.some((f) => !Number.isSafeInteger(f.uncompressedSize) || f.uncompressedSize < 0) ||
    entradas.reduce((s, f) => s + f.uncompressedSize, 0) > 100 * 1024 * 1024
  )
    throw new Error('VSIX excede o limite de inspecao de privacidade.');
  const base = resolve(__dirname, '..', 'test', '.tmp');
  await mkdir(base, { recursive: true });
  const pasta = await mkdtemp(join(base, 'privacidade-'));
  const violacoes = [];
  const arquivos = [];
  const vistos = new Set();
  try {
    for (const entrada of entradas) {
      const nome = entrada.path.replaceAll('\\', '/');
      const motivos = motivosArquivo(nome);
      const normalizado = nome.toLowerCase();
      if (vistos.has(normalizado))
        throw new Error('VSIX contem entrada duplicada; extracao recusada.');
      vistos.add(normalizado);
      const destino = resolve(pasta, ...nome.split('/'));
      if (
        !destino.startsWith(pasta + sep) ||
        posix.normalize(nome) !== nome ||
        ((entrada.externalFileAttributes >>> 16) & 0xf000) === 0xa000
      )
        motivos.push('caminho inseguro no arquivo ZIP');
      if (motivos.includes('caminho inseguro no arquivo ZIP'))
        throw new Error('VSIX contem caminho inseguro; extracao recusada.');
      arquivos.push(nome);
      for (const motivo of motivos)
        violacoes.push({
          arquivo: motivosConteudo(nome, usuario).length ? '(nome omitido)' : nome,
          motivo,
        });
    }
    for (const entrada of entradas) {
      const nome = entrada.path.replaceAll('\\', '/');
      // Arquivos proibidos sao recusados por nome, sem ler dados, .env ou credenciais.
      if (motivosArquivo(nome).length) continue;
      const conteudo = await entrada.buffer();
      const destino = resolve(pasta, ...nome.split('/'));
      await mkdir(resolve(destino, '..'), { recursive: true });
      await writeFile(destino, conteudo, { mode: 0o600 });
      for (const motivo of motivosConteudo(conteudo, usuario))
        violacoes.push({
          arquivo: motivosConteudo(nome, usuario).length ? '(nome omitido)' : nome,
          motivo,
        });
      // UTF-16 LE/BE tambem e inspecionado, inclusive em recursos binarios.
      for (const texto of [
        conteudo.toString('utf16le'),
        Buffer.from(conteudo.subarray(0, conteudo.length - (conteudo.length % 2)))
          .swap16()
          .toString('utf16le'),
      ])
        for (const motivo of motivosConteudo(texto, usuario))
          if (!violacoes.some((v) => v.arquivo === nome && v.motivo === motivo))
            violacoes.push({ arquivo: nome, motivo });
    }
    return { arquivos: arquivos.sort(), violacoes };
  } finally {
    if (!pasta.startsWith(base + sep)) throw new Error('Diretorio de inspecao fora do workspace.');
    await rm(pasta, { recursive: true, force: true });
  }
}

async function main() {
  const { name, version } = require('../package.json');
  const argumento = process.argv.slice(2).find((a) => a !== '--listar');
  const resultado = await verificarVsix(
    argumento ?? resolve(__dirname, '..', `${name}-${version}.vsix`),
  );
  if (resultado.violacoes.length) {
    console.error('Privacidade reprovada:');
    for (const v of resultado.violacoes) console.error(`- ${v.arquivo}: ${v.motivo}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Privacidade aprovada: ${resultado.arquivos.length} arquivos inspecionados; nenhum dado pessoal, segredo ou arquivo proibido.`,
  );
  if (process.argv.includes('--listar')) for (const nome of resultado.arquivos) console.log(nome);
}
module.exports = { motivosConteudo, motivosArquivo, verificarVsix };
if (require.main === module)
  main().catch(() => {
    console.error('Nao foi possivel inspecionar o VSIX com seguranca.');
    process.exitCode = 1;
  });
