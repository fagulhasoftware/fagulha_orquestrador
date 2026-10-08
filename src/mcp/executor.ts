import { open, writeFile, stat, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Sala } from '../core/sala';
import { caminhoReal, dentro, mascarar, sensivel } from '../core/seguranca';
import { validarArgumentos } from './ferramentas';
import { lerPagina, validarUrl } from '../browser/pagina';
import { rodar } from '../providers/processo';
import type { CategoriaAcao } from '../shared/protocolo';
import { validarMemoria } from '../core/memoria';
import { irreversivelExterno } from '../permissions/irreversivel';
import { lerImagem, eConteudoImagem } from '../attachments/imagem';
import { ErroFerramenta } from './erros';
export function comandoCritico(comando: string): boolean {
  if (
    /\b(rm|rmdir|del|erase|Remove-Item|format|mkfs|diskpart|shutdown|reboot|drop|truncate)\b|\bgit\s+(push|reset|clean)\b|\b(npm|pnpm|yarn)\s+publish\b|\b(curl|wget|Invoke-WebRequest)\b|[;&|`<>\r\n]|\$\(/i.test(
      comando,
    )
  )
    return true;
  // Scripts/comandos opacos podem destruir ou publicar: exigem aprovacao individual.
  return !/^(pwd|Get-Location|echo(?:\s+.*)?|git\s+(status|diff|log)(?:\s+.*)?|ls(?:\s+.*)?|Get-ChildItem(?:\s+.*)?|cat\s+[^\s]+|Get-Content\s+[^\s]+)\s*$/i.test(
    comando.trim(),
  );
}
function validarComando(comando: string): void {
  if (
    comando !== mascarar(comando) ||
    comando.split(/[\s"']+/).some(sensivel) ||
    /[\r\n]/.test(comando)
  )
    throw new Error('Comando contem destino protegido ou conteudo invalido.');
}
// Claude Code internal tools that only plan or organize the session (no file, network or process effect).
const FERRAMENTAS_INTERNAS = new Set(['TodoWrite', 'TodoRead', 'ExitPlanMode', 'Task', 'Agent', 'ToolSearch']);

export class ExecutorFerramentas {
  constructor(
    private sala: Sala,
    private raizes: string[],
    private abrir: (url: string) => Promise<void>,
    private pastaSessoes?: string,
  ) {}
  async executar(
    id: string,
    nome: string,
    entrada: Record<string, unknown>,
    sinal: AbortSignal,
  ): Promise<unknown> {
    const args = validarArgumentos(nome, entrada);
    const agente = this.sala.provedores.get(id)?.agente;
    if (!agente || sinal.aborted) throw new Error('Execucao encerrada.');
    if (nome === 'perguntar_usuario') return this.sala.perguntas.perguntar(id, args, sinal);
    const chatId = this.sala.chat.id;
    const confirmarChat = async () => {
      if (this.sala.chat.id !== chatId || sinal.aborted)
        throw new Error('Execucao encerrada ao trocar de chat.');
      await this.sala.chats.obter(chatId);
    };
    if (nome === 'aprovar') {
      const ferramenta = String(args.tool_name).replace(/^mcp__fagulha_orquestrador__/, '');
      if (String(args.tool_name).startsWith('mcp__fagulha_orquestrador__')) {
        // Orquestrador tools run their own approval gate; here only their arguments are checked.
        try {
          const input = validarArgumentos(ferramenta, args.input ?? {});
          return { behavior: 'allow', updatedInput: input };
        } catch (e) {
          return {
            behavior: 'deny',
            message: `Orquestrador tool ${ferramenta} rejected its arguments: ${e instanceof Error ? e.message : 'invalid arguments'}`,
          };
        }
      }
      if (this.sala.config.nivel === 'manual')
        return {
          behavior: 'deny',
          message: 'Ferramentas nativas indisponiveis: execute via MCP Orquestrador Fagulha.',
        };
      const ferramentaNativa = String(args.tool_name),
        input = args.input as Record<string, unknown>;
      try {
        let categoria: CategoriaAcao,
          detalhe: string,
          critica = false;
        if (FERRAMENTAS_INTERNAS.has(ferramentaNativa)) {
          // Planning/bookkeeping tools of the CLI itself: no effect outside the agent session.
          return { behavior: 'allow', updatedInput: input };
        } else if (/^mcp__[\w.-]+__[\w.-]+$/.test(ferramentaNativa)) {
          // Tools from MCP servers configured by the user (Figma, Gmail, Supabase, GitHub...).
          const nomeAcao = ferramentaNativa.split('__').slice(2).join('__').toLowerCase();
          categoria = /(delete|remove|drop|destroy|purge|truncate|erase|wipe)/.test(nomeAcao)
            ? 'irreversivel_externo'
            : /(send|publish|post|reply|forward|invite|share|create_release|merge)/.test(nomeAcao)
              ? 'publicacao'
              : 'externo';
          detalhe = `${ferramentaNativa} ${JSON.stringify(input).slice(0, 1500)}`;
          critica = categoria === 'irreversivel_externo';
        } else if (ferramentaNativa === 'Bash') {
          detalhe = String(input.command ?? '');
          if (!detalhe) throw new Error('Comando vazio.');
          validarComando(detalhe);
          categoria = irreversivelExterno(detalhe) ? 'irreversivel_externo' : 'comando';
          critica = comandoCritico(detalhe);
        } else if (ferramentaNativa === 'WebFetch' || ferramentaNativa === 'WebSearch') {
          if (ferramentaNativa === 'WebFetch') {
            detalhe = validarUrl(String(input.url)).href;
            categoria = 'rede_leitura';
          } else {
            detalhe = String(input.query ?? '').slice(0, 2000);
            categoria = 'rede_leitura';
          }
        } else {
          const escrita = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(ferramentaNativa);
          if (!escrita && !['Read', 'Glob', 'Grep', 'LS', 'NotebookRead'].includes(ferramentaNativa))
            throw new Error(`Native tool ${ferramentaNativa} has no policy: use the Orquestrador MCP tools.`);
          const caminho = String(input.file_path ?? input.notebook_path ?? input.path ?? this.sala.projeto ?? '.');
          const real = await caminhoReal(
            resolve(this.sala.projeto ?? process.cwd(), caminho),
            escrita,
          );
          const raizes = await Promise.all(this.raizes.map((r) => realpath(r)));
          // Images that Orquestrador prepared for this agent (attachments of the current message) count as
          // project reads, so the agent can see them without an extra approval.
          const imagemDaSala =
            !escrita &&
            !!this.pastaSessoes &&
            /\.(png|jpe?g|webp|gif)$/i.test(real) &&
            dentro(await realpath(this.pastaSessoes).catch(() => this.pastaSessoes!), real);
          const workspace = imagemDaSala || raizes.some((r) => dentro(r, real));
          categoria = escrita
            ? workspace
              ? 'escrita_workspace'
              : 'escrita_maquina'
            : workspace
              ? 'leitura_workspace'
              : 'leitura_maquina';
          detalhe = real;
        }
        await this.sala.portao.executar(
          {
            agente: id,
            modo: agente.modo,
            categoria,
            resumo: `Claude: ${ferramentaNativa}`,
            detalhe,
            critica,
          },
          confirmarChat,
          sinal,
        );
        return { behavior: 'allow', updatedInput: input };
      } catch (e) {
        return {
          behavior: 'deny',
          message: `Approval gate refused ${ferramentaNativa}${e instanceof Error && e.message ? `: ${e.message}` : ''}. Use the Orquestrador MCP tools for an allowed action.`,
        };
      }
    }
    const portao = async <T>(
      categoria: CategoriaAcao,
      resumo: string,
      detalhe: string,
      fn: () => Promise<T>,
      critica = false,
      somenteSala = false,
    ) =>
      this.sala.portao.executar(
        {
          agente: id,
          modo: somenteSala ? 'leitura_escrita' : agente.modo,
          categoria,
          resumo,
          detalhe,
          critica,
        },
        async () => {
          await confirmarChat();
          const r = await fn();
          this.sala.mensagem(
            agente.nick,
            `Resultado ${nome}: ${mascarar(
              eConteudoImagem(r)
                ? r.conteudoMcp
                    .filter((c) => c.type === 'text')
                    .map((c) => c.text)
                    .join('\n')
                : typeof r === 'string'
                  ? r
                  : JSON.stringify(r),
            ).slice(0, 3000)}`,
            'acao',
          );
          return r;
        },
        sinal,
      );
    if (nome === 'memoria_propor') {
      const texto = validarMemoria(String(args.texto));
      const escopo = args.escopo as 'global' | 'projeto';
      if (escopo === 'projeto' && !this.sala.projeto)
        throw new Error('Abra uma pasta para propor memoria de projeto.');
      return portao(
        'memoria',
        `Guardar na memoria: ${texto.slice(0, 100)}`,
        `Texto: ${texto}\nEscopo: ${escopo}`,
        async () => {
          const memoria = await this.sala.salvarMemoria({ texto, escopo }, agente.nick);
          return { guardada: true, id: memoria.id };
        },
        true,
        true,
      );
    }
    if (nome === 'sala_publicar')
      return portao(
        'escrita_workspace',
        'Publicar na sala',
        String(args.texto),
        async () => {
          this.sala.mensagem(agente.nick, String(args.texto));
          return { publicado: true };
        },
        false,
        true,
      );
    if (nome === 'sala_ler')
      return portao(
        'leitura_workspace',
        'Ler conversa',
        'Ultimas 80 mensagens',
        async () => this.sala.mensagens.slice(-80),
        false,
        true,
      );
    const enviados = new Set(this.sala.mensagens.flatMap((m) => (m.anexos ?? []).map((a) => a.id)));
    if (nome === 'anexos_listar')
      return portao(
        'leitura_workspace',
        'Listar anexos',
        'Metadados da sala',
        async () =>
          [...this.sala.anexos.values()].filter((a) => enviados.has(a.meta.id)).map((a) => a.meta),
        false,
        true,
      );
    if (nome === 'anexo_ler')
      return portao(
        'leitura_workspace',
        'Ler anexo',
        String(args.id),
        async () => {
          const chave = String(args.id);
          let a = this.sala.anexos.get(chave);
          if (a && !enviados.has(a.meta.id))
            throw new ErroFerramenta('Anexo pertence a outro chat ou ainda nao foi enviado.');
          if (!a) {
            const candidatos = [...this.sala.anexos.values()].filter(
              (x) => enviados.has(x.meta.id) && x.meta.nome === chave,
            );
            if (candidatos.length > 1)
              throw new ErroFerramenta(
                `Nome de anexo ambiguo; use um destes ids: ${candidatos.map((x) => x.meta.id).join(', ')}.`,
              );
            a = candidatos[0];
          }
          if (!a) {
            if (await this.sala.storage.obter('anexos', this.sala.id, chave))
              throw new ErroFerramenta('Anexo pertence a outro chat.');
            throw new ErroFerramenta(
              `Anexo nao encontrado (ids disponiveis: ${[...enviados].join(', ') || 'nenhum'}).`,
            );
          }
          if (a.meta.tratamento === 'recusado')
            throw new ErroFerramenta(
              'Anexo recusado: arquivo maior que o limite ou tipo nao suportado.',
            );
          if (a.meta.tipo === 'imagem') {
            if (!a.arquivo) throw new ErroFerramenta('Arquivo da imagem indisponivel.');
            return lerImagem(a.arquivo, this.sala.config.limites.imagemMaxMB);
          }
          if (a.meta.tipo === 'outro') throw new ErroFerramenta('Tipo de anexo nao suportado.');
          return a.texto;
        },
        false,
        true,
      );
    if (nome === 'arquivo_ler' || nome === 'arquivo_escrever') {
      const escrever = nome === 'arquivo_escrever';
      const solicitado = resolve(this.sala.projeto ?? process.cwd(), String(args.caminho));
      const real = await caminhoReal(solicitado, escrever);
      const raizes = await Promise.all(this.raizes.map((r) => realpath(r)));
      const workspace = raizes.some((r) => dentro(r, real));
      const categoria: CategoriaAcao = escrever
        ? workspace
          ? 'escrita_workspace'
          : 'escrita_maquina'
        : workspace
          ? 'leitura_workspace'
          : 'leitura_maquina';
      let existente = false;
      try {
        await stat(real);
        existente = true;
      } catch {}
      const detalhe = escrever
        ? `${real}\n${Buffer.byteLength(String(args.texto))} bytes\nNovo conteudo (primeiros 4000 caracteres):\n${String(args.texto).slice(0, 4000)}`
        : real;
      return portao(
        categoria,
        `${escrever ? 'Escrever' : 'Ler'} ${String(args.caminho)}`,
        detalhe,
        async () => {
          if ((await caminhoReal(solicitado, escrever)) !== real)
            throw new Error('Destino mudou apos a aprovacao.');
          if (escrever) {
            const texto = String(args.texto);
            if (texto !== mascarar(texto)) throw new Error('Conteudo contem possivel segredo.');
            await writeFile(real, texto, { mode: 0o600 });
            return { escrito: true, bytes: Buffer.byteLength(texto) };
          }
          if (/\.(png|jpe?g|webp|gif)$/i.test(real))
            return lerImagem(real, this.sala.config.limites.imagemMaxMB);
          const arquivo = await open(real, 'r');
          try {
            const info = await arquivo.stat();
            if (!info.isFile()) throw new Error('Somente arquivos.');
            const b = Buffer.alloc(Math.min(info.size, 512 * 1024));
            const r = await arquivo.read(b, 0, b.length, 0);
            return {
              texto: mascarar(b.subarray(0, r.bytesRead).toString('utf8')),
              truncado: info.size > b.length,
            };
          } finally {
            await arquivo.close();
          }
        },
        escrever && existente,
      );
    }
    if (nome === 'comando_executar') {
      const comando = String(args.comando);
      validarComando(comando);
      return portao(
        irreversivelExterno(comando) ? 'irreversivel_externo' : 'comando',
        'Executar shell',
        comando,
        async () => {
          const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
          const argsShell =
            process.platform === 'win32'
              ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', comando]
              : ['-c', comando];
          return mascarar(
            await rodar(shell, argsShell, {
              cwd: this.sala.projeto ?? undefined,
              sinal,
              timeoutMs: 60_000,
            }),
          );
        },
        comandoCritico(comando),
      );
    }
    if (nome === 'navegador_ler' || nome === 'navegador_abrir') {
      const url = validarUrl(String(args.url)).href;
      if (nome === 'navegador_abrir')
        return portao('navegador', 'Abrir navegador', url, async () => {
          await this.abrir(url);
          return { aberto: true };
        });
      return portao('rede_leitura', 'Ler pagina', url, async () =>
        lerPagina(url, sinal, async (redirect) => {
          await this.sala.portao.executar(
            {
              agente: id,
              modo: agente.modo,
              categoria: 'rede_leitura',
              resumo: 'Seguir redirecionamento',
              detalhe: redirect,
            },
            async () => {},
            sinal,
          );
        }),
      );
    }
    throw new Error('Ferramenta desconhecida.');
  }
}
