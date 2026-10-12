import { readdir, readFile, stat, mkdir, cp, rm, realpath } from 'node:fs/promises';
import { join, basename, resolve, sep } from 'node:path';
import type { Skill } from '../shared/protocolo';
import { mascarar, sensivel } from '../core/seguranca';
import { Open } from 'unzipper';
import { writeFile } from 'node:fs/promises';

export class Skills {
  private itens = new Map<string, { meta: Skill; arquivo: string }>();
  constructor(
    private pasta: string,
    private raizes: string[],
    private carregar: () => Promise<string[]>,
    private salvar: (nomes: string[]) => Promise<void>,
  ) {}
  async listar(): Promise<Skill[]> {
    const desativadas = new Set(await this.carregar());
    const arquivos: { arquivo: string; data: number }[] = [];
    const visitar = async (p: string, profundidade: number): Promise<void> => {
      if (profundidade > 9 || arquivos.length >= 1500) return;
      try {
        const filhos = await readdir(p, { withFileTypes: true });
        for (const f of filhos) {
          if (
            f.isSymbolicLink() ||
            [
              'node_modules',
              '.git',
              'scripts',
              'references',
              'examples',
              'templates',
              'assets',
            ].includes(f.name)
          )
            continue;
          const caminho = join(p, f.name);
          if (f.isFile() && f.name === 'SKILL.md')
            arquivos.push({ arquivo: caminho, data: (await stat(caminho)).mtimeMs });
          else if (f.isDirectory()) await visitar(caminho, profundidade + 1);
        }
      } catch {
        /* raiz opcional inexistente */
      }
    };
    for (const raiz of [this.pasta, ...this.raizes]) await visitar(raiz, 0);
    this.itens.clear();
    for (const { arquivo } of arquivos.sort((a, b) => b.data - a.data)) {
      const info = await stat(arquivo);
      if (info.size > 256 * 1024) continue;
      const texto = await readFile(arquivo, 'utf8');
      const front = texto.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!front) continue;
      const nome = (
        front[1].match(/^name:\s*["']?([^\r\n"']+)/m)?.[1] ?? basename(resolve(arquivo, '..'))
      )
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}_:-]+/gu, '-');
      if (!nome || this.itens.has(nome)) continue;
      const descricao = (
        front[1].match(/^description:\s*["']?([^\r\n]+)/m)?.[1] ?? 'Skill local instalada.'
      )
        .replace(/["']$/, '')
        .slice(0, 400);
      this.itens.set(nome, {
        arquivo,
        meta: {
          nome,
          descricao: mascarar(descricao),
          origem: 'pasta',
          fonte: arquivo,
          ativa: !desativadas.has(nome),
          bytes: info.size,
          instaladaEm: info.mtime.toISOString(),
        },
      });
    }
    return [...this.itens.values()].map((x) => x.meta).sort((a, b) => a.nome.localeCompare(b.nome));
  }
  async ler(nome: string, visualizar = false): Promise<string> {
    const item = this.itens.get(nome);
    if (!item) throw new Error('Skill nao encontrada. Atualize o catalogo.');
    if (!item.meta.ativa && !visualizar) throw new Error('Skill desativada na sala.');
    if ((await stat(item.arquivo)).size > 256 * 1024) throw new Error('Skill excede 256 KB.');
    return `Origem da skill: ${item.arquivo}\n${mascarar(await readFile(item.arquivo, 'utf8'))}`;
  }
  async alternar(nome: string, ativa: boolean) {
    if (!this.itens.has(nome)) throw new Error('Skill nao encontrada.');
    const nomes = new Set(await this.carregar());
    ativa ? nomes.delete(nome) : nomes.add(nome);
    await this.salvar([...nomes]);
    this.itens.get(nome)!.meta.ativa = ativa;
  }
  async importar(pasta: string) {
    const origem = await realpath(pasta);
    const texto = await readFile(join(origem, 'SKILL.md'), 'utf8');
    const nome = (
      texto.match(/^name:\s*["']?([a-zA-Z0-9_-]+)/m)?.[1] ?? basename(origem)
    ).toLowerCase();
    if (!/^[a-z0-9_-]{1,100}$/.test(nome)) throw new Error('Nome da skill invalido.');
    await mkdir(this.pasta, { recursive: true });
    const destino = join(this.pasta, nome);
    try {
      await stat(destino);
      throw new Error('Skill ja importada.');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    let total = 0;
    try {
      await cp(origem, destino, {
        recursive: true,
        errorOnExist: true,
        force: false,
        filter: async (p) => {
          const i = await import('node:fs/promises').then((f) => f.lstat(p));
          if (i.isSymbolicLink() || sensivel(p) || basename(p) === '.git')
            throw new Error('Skill contem arquivo protegido ou link simbolico.');
          total += i.isFile() ? i.size : 0;
          if (total > 20 * 1024 * 1024) throw new Error('Skill excede 20 MB.');
          return true;
        },
      });
    } catch (e) {
      await rm(destino, { recursive: true, force: true });
      throw e;
    }
    await this.listar();
    await this.alternar(nome, true);
  }
  async importarZip(arquivo: string, temporaria: string, caminho?: string) {
    const zip = await Open.file(arquivo);
    if (
      zip.files.length > 2000 ||
      zip.files.reduce((n, f) => n + f.uncompressedSize, 0) > 20 * 1024 * 1024
    )
      throw new Error('ZIP de skill excede limites.');
    const nomes = new Set<string>();
    for (const f of zip.files) {
      const p = f.path.replaceAll('\\', '/');
      if (
        p.startsWith('/') ||
        /[:\u0000-\u001f]/.test(p) ||
        p.split('/').some((s) => /[. ]$/.test(s)) ||
        p.split('/').some((s) => s === '..') ||
        /^[a-z]:/i.test(p) ||
        sensivel(p)
      )
        throw new Error('ZIP de skill contem caminho protegido.');
      if (nomes.has(p.toLowerCase())) throw new Error('ZIP de skill contem duplicatas.');
      nomes.add(p.toLowerCase());
    }
    await mkdir(temporaria, { recursive: true });
    try {
      let bytes = 0;
      for (const f of zip.files) {
        if (f.type !== 'File') continue;
        const p = resolve(temporaria, f.path);
        if (!p.startsWith(resolve(temporaria) + sep)) throw new Error('Destino ZIP invalido.');
        const chunks: Buffer[] = [];
        for await (const c of f.stream()) {
          bytes += c.length;
          if (bytes > 20 * 1024 * 1024) throw new Error('ZIP expandido excede limite.');
          chunks.push(c);
        }
        await mkdir(resolve(p, '..'), { recursive: true });
        await writeFile(p, Buffer.concat(chunks));
      }
      const candidatos = zip.files.filter(
        (f) =>
          /(^|\/)SKILL\.md$/.test(f.path) &&
          (!caminho || f.path.endsWith('/' + caminho + '/SKILL.md')),
      );
      if (candidatos.length !== 1)
        throw new Error('Escolha uma unica pasta de skill ou URL GitHub /tree/ref/pasta.');
      await this.importar(resolve(temporaria, candidatos[0].path, '..'));
    } finally {
      await rm(temporaria, { recursive: true, force: true });
    }
  }
  async remover(nome: string) {
    const item = this.itens.get(nome);
    if (!item) throw new Error('Skill nao encontrada.');
    const real = await realpath(item.arquivo);
    const base = await realpath(this.pasta).catch(() => resolve(this.pasta));
    const destino = resolve(real, '..');
    if (!real.startsWith(base + sep) || destino === base)
      throw new Error(
        'Skill pertence ao agente. Desative na sala; remova pelo instalador de origem.',
      );
    await rm(destino, { recursive: true, force: true });
    await this.listar();
  }
}
