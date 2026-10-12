import { spawn, type ChildProcess } from 'node:child_process';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { validarUrl } from './pagina';
import { matarArvore } from '../providers/processo';

// Apenas navegador iniciado por esta sala, com perfil temporario: nunca conecta ao perfil pessoal.
export class NavegadorControlado {
  private processo?: ChildProcess;
  private perfil?: string;
  private ws?: WebSocket;
  private sequencia = 0;
  private encerrando?: Promise<void>;
  private pendentes = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  async iniciar(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    await this.fechar();
    const candidatos =
      process.platform === 'win32'
        ? [
            join(
              process.env.PROGRAMFILES ?? 'C:\\Program Files',
              'Google/Chrome/Application/chrome.exe',
            ),
            join(
              process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)',
              'Microsoft/Edge/Application/msedge.exe',
            ),
            join(homedir(), 'AppData/Local/Google/Chrome/Application/chrome.exe'),
          ]
        : process.platform === 'darwin'
          ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
          : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
    let executavel: string | undefined;
    for (const c of candidatos) {
      try {
        await access(c);
        executavel = c;
        break;
      } catch {}
    }
    if (!executavel) throw new Error('Chrome/Edge nao encontrado para navegador dedicado da sala.');
    this.perfil = await mkdtemp(join(tmpdir(), 'fagulha-browser-'));
    try {
      this.processo = spawn(
        executavel,
        [
          '--headless=new',
          '--remote-debugging-address=127.0.0.1',
          '--remote-debugging-port=0',
          `--user-data-dir=${this.perfil}`,
          '--no-first-run',
          '--no-default-browser-check',
          'about:blank',
        ],
        { windowsHide: true, stdio: 'ignore' },
      );
      let falha: Error | undefined;
      this.processo.once('error', (e) => {
        falha = e;
      });
      let porta: number | undefined;
      for (let i = 0; i < 100; i++) {
        if (falha) throw falha;
        try {
          porta = Number(
            (await readFile(join(this.perfil, 'DevToolsActivePort'), 'utf8')).split('\n')[0],
          );
          if (porta) break;
        } catch {}
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!porta) throw new Error('Navegador dedicado nao iniciou em 10 segundos.');
      const resposta = await fetch(`http://127.0.0.1:${porta}/json/list`, {
        signal: AbortSignal.timeout(5000),
      });
      const paginas = (await resposta.json()) as { type: string; webSocketDebuggerUrl: string }[];
      const pagina = paginas.find((p) => p.type === 'page');
      if (!pagina) throw new Error('Pagina de controle indisponivel.');
      const destino = new URL(pagina.webSocketDebuggerUrl);
      if (destino.hostname !== '127.0.0.1' || destino.protocol !== 'ws:')
        throw new Error('Destino CDP invalido.');
      const ws = (this.ws = new WebSocket(destino.href, {
        maxPayload: 12 * 1024 * 1024,
        handshakeTimeout: 5000,
      }));
      ws.on('message', (dados) => {
        try {
          const j = JSON.parse(dados.toString());
          const p = this.pendentes.get(j.id);
          if (p) {
            this.pendentes.delete(j.id);
            j.error
              ? p.reject(new Error('Falha do navegador: ' + j.error.message))
              : p.resolve(j.result);
          }
        } catch {}
      });
      ws.on('close', () => {
        for (const p of this.pendentes.values()) p.reject(new Error('Navegador encerrado.'));
        this.pendentes.clear();
      });
      await new Promise<void>((resolve, reject) => {
        ws.once('open', resolve);
        ws.once('error', reject);
      });
      await this.chamar('Page.enable');
    } catch (e) {
      await this.fechar();
      throw e;
    }
  }
  private async chamar(method: string, params: object = {}): Promise<any> {
    const id = ++this.sequencia;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendentes.delete(id);
        reject(new Error('Tempo limite do navegador.'));
      }, 15000);
      this.pendentes.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.ws!.send(JSON.stringify({ id, method, params }), (e) => {
        if (e) {
          clearTimeout(timer);
          this.pendentes.delete(id);
          reject(e);
        }
      });
    });
  }
  async navegar(url: string) {
    validarUrl(url);
    await this.iniciar();
    const r = await this.chamar('Page.navigate', { url });
    if (r.errorText) throw new Error('Navegacao falhou: ' + r.errorText);
    return { navegou: true, url };
  }
  private async avaliar(expression: string) {
    await this.iniciar();
    const r = await this.chamar('Runtime.evaluate', { expression, returnByValue: true });
    if (r.exceptionDetails) throw new Error('Elemento ausente ou acao indisponivel na pagina.');
    return r.result.value;
  }
  async estado() {
    return this.avaliar(
      `JSON.stringify({url:location.href,titulo:document.title,texto:(document.body?.innerText||'').slice(0,24000),elementos:Array.from(document.querySelectorAll('a,button,input,select,textarea')).slice(0,120).map(e=>({tag:e.tagName,id:e.id,nome:e.getAttribute('name'),tipo:e.getAttribute('type'),texto:(e.innerText||e.getAttribute('aria-label')||'').slice(0,160)}))})`,
    );
  }
  async clicar(seletor: string) {
    return this.avaliar(
      `(()=>{const e=document.querySelector(${JSON.stringify(seletor)});if(!e)throw Error();e.click();return {clicou:true}})()`,
    );
  }
  async preencher(seletor: string, texto: string) {
    return this.avaliar(
      `(()=>{const e=document.querySelector(${JSON.stringify(seletor)});if(!(e instanceof HTMLInputElement||e instanceof HTMLTextAreaElement))throw Error();const s=Object.getOwnPropertyDescriptor(e instanceof HTMLInputElement?HTMLInputElement.prototype:HTMLTextAreaElement.prototype,'value').set;s.call(e,${JSON.stringify(texto)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return {preencheu:true}})()`,
    );
  }
  async captura() {
    await this.iniciar();
    const r = await this.chamar('Page.captureScreenshot', { format: 'png' });
    return { conteudoMcp: [{ type: 'image' as const, data: r.data, mimeType: 'image/png' }] };
  }
  async fechar() {
    if (this.encerrando) return this.encerrando;
    this.encerrando = this.encerrar();
    try {
      await this.encerrando;
    } finally {
      this.encerrando = undefined;
    }
  }
  private async encerrar() {
    this.ws?.close();
    this.ws = undefined;
    if (this.processo) {
      const p = this.processo;
      matarArvore(p.pid);
      await new Promise<void>((r) => {
        if (p.exitCode !== null) r();
        else {
          p.once('exit', () => r());
          setTimeout(r, 3000);
        }
      });
    }
    this.processo = undefined;
    if (this.perfil)
      await rm(this.perfil, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
    this.perfil = undefined;
  }
}
