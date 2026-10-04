import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { EstadoVoz } from '../shared/protocolo';
import { artefato } from './catalogo';
import { executarVoz, type FabricaProcesso } from './processo';
import type { ConfiguracaoVoz } from './configuracao';

export const SCRIPT_VOZES =
  '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; try { @($s.GetInstalledVoices() | Where-Object Enabled | ForEach-Object { @{id=$_.VoiceInfo.Name;nome=$_.VoiceInfo.Name} }) | ConvertTo-Json -Compress } finally { $s.Dispose() }';
export interface DetectadoVoz {
  estado: EstadoVoz;
  ffmpeg?: string;
  whisper?: string;
  modelo: string;
  tts?: string;
}
export function argumentosMicrofones(so: NodeJS.Platform): string[] {
  return so === 'win32'
    ? ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy']
    : ['-hide_banner', '-list_devices', 'true', '-f', 'avfoundation', '-i', ''];
}
export function analisarMicrofones(saida: string, so: NodeJS.Platform): EstadoVoz['dispositivos'] {
  if (so === 'win32')
    return [...saida.matchAll(/"([^"\r\n]+)"\s*\(audio\)/g)].map((m) => ({ id: m[1], nome: m[1] }));
  if (so === 'darwin') {
    const audio = saida.split('AVFoundation audio devices:')[1] ?? '';
    return [...audio.matchAll(/\[(\d+)\]\s+([^\r\n]+)/g)].map((m) => ({
      id: m[1],
      nome: m[2].trim(),
    }));
  }
  const itens = saida
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => l.split(/\s+/)[1])
    .filter((n) => n && !n.endsWith('.monitor'));
  return [
    { id: 'default', nome: 'Microfone padrão (PulseAudio)' },
    ...itens.map((n) => ({ id: n, nome: n })),
    { id: 'alsa:default', nome: 'Microfone padrão (ALSA, alternativa)' },
  ];
}
export function analisarVozes(saida: string, so: NodeJS.Platform): EstadoVoz['leitura']['vozes'] {
  if (so === 'win32') {
    try {
      const parsed: unknown = JSON.parse(saida.replace(/^\uFEFF/, ''));
      const itens = Array.isArray(parsed) ? parsed : [parsed];
      return itens.filter(
        (v): v is { id: string; nome: string } =>
          !!v && typeof v.id === 'string' && typeof v.nome === 'string',
      );
    } catch {
      return [];
    }
  }
  if (so === 'darwin')
    return saida.split(/\r?\n/).flatMap((l) => {
      const m = l.match(/^(.+?)\s+[a-z]{2}[_-][A-Z]{2}\s+#/);
      return m ? [{ id: m[1].trim(), nome: m[1].trim() }] : [];
    });
  return saida
    .split(/\r?\n/)
    .slice(1)
    .flatMap((l) => {
      const m = l.trim().split(/\s+/);
      return m.length >= 4 ? [{ id: m[3], nome: `${m[3]} (${m[1]})` }] : [];
    });
}
export async function detectarVoz(
  pasta: string,
  config: ConfiguracaoVoz,
  so: NodeJS.Platform = process.platform,
  fabrica?: FabricaProcesso,
): Promise<DetectadoVoz> {
  const falhas = new Set<string>();
  const procurar = async (nome: string, args: string[]): Promise<string | undefined> => {
    const proprio = join(pasta, 'bin', nome + (so === 'win32' ? '.exe' : ''));
    const candidatos = [
      ...(await stat(proprio).then(
        (s) => (s.isFile() ? [proprio] : []),
        () => [],
      )),
      nome,
    ];
    for (const cmd of candidatos) {
      try {
        if ((await executarVoz(cmd, args, { fabrica, timeoutMs: 5000 })).codigo === 0) return cmd;
      } catch {}
      if (cmd === proprio) falhas.add(nome);
    }
    return undefined;
  };
  const [ffmpeg, whisper] = await Promise.all([
    procurar('ffmpeg', ['-version']),
    procurar('whisper-cli', ['--help']),
  ]);
  const modelo = join(pasta, 'modelos', `ggml-${config.modelo}.bin`);
  const existeModelo = await stat(modelo).then(
    (s) => s.isFile() && s.size === artefato('modelo', config.modelo).tamanhoBytes,
    () => false,
  );
  const componentes: EstadoVoz['componentes'] = (['ffmpeg', 'whisper', 'modelo'] as const).map(
    (componente) => {
      const a = artefato(componente, config.modelo);
      const instalado =
        componente === 'ffmpeg' ? !!ffmpeg : componente === 'whisper' ? !!whisper : existeModelo;
      const manual = componente !== 'modelo' && (so !== 'win32' || process.arch !== 'x64');
      return {
        componente,
        nome: manual
          ? componente === 'ffmpeg'
            ? 'FFmpeg (sistema)'
            : 'whisper.cpp (sistema)'
          : a.nome,
        situacao: instalado ? 'instalado' : manual ? 'manual' : 'ausente',
        origem: manual
          ? componente === 'ffmpeg'
            ? 'https://ffmpeg.org/download.html'
            : 'https://github.com/ggml-org/whisper.cpp'
          : a.url,
        tamanhoBytes: manual ? undefined : a.tamanhoBytes,
        ...(manual && !instalado
          ? {
              comandoManual:
                so === 'darwin'
                  ? 'brew install ffmpeg whisper.cpp'
                  : componente === 'ffmpeg'
                    ? so === 'win32'
                      ? 'Instale FFmpeg para sua arquitetura e adicione ao PATH.'
                      : 'sudo apt install ffmpeg'
                    : 'Compile whisper.cpp: https://github.com/ggml-org/whisper.cpp#quick-start',
            }
          : {}),
        ...(!instalado &&
        falhas.has(componente === 'ffmpeg' ? 'ffmpeg' : 'whisper-cli') &&
        componente !== 'modelo'
          ? {
              situacao: manual ? ('manual' as const) : ('erro' as const),
              mensagem:
                componente === 'whisper' && so === 'win32'
                  ? 'O whisper.cpp não iniciou. Verifique o Microsoft Visual C++ Redistributable x64 e as DLLs locais.'
                  : 'O executável local não iniciou. Verifique os componentes e permissões do sistema.',
            }
          : {}),
      };
    },
  );
  let dispositivos: EstadoVoz['dispositivos'] = [];
  if (ffmpeg) {
    try {
      const r =
        so === 'linux'
          ? await executarVoz('pactl', ['list', 'short', 'sources'], { fabrica })
          : await executarVoz(ffmpeg, argumentosMicrofones(so), { fabrica });
      dispositivos = analisarMicrofones(
        so === 'linux' ? (r.codigo === 0 ? r.saida : '') : r.saida + '\n' + r.erro,
        so,
      );
    } catch {
      if (so === 'linux') dispositivos = analisarMicrofones('', so);
    }
  }
  let tts: string | undefined;
  let vozes: EstadoVoz['leitura']['vozes'] = [];
  try {
    if (so === 'win32') {
      const r = await executarVoz(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', SCRIPT_VOZES],
        { fabrica },
      );
      vozes = analisarVozes(r.saida, so);
      if (r.codigo === 0 && vozes.length) tts = 'powershell.exe';
    } else if (so === 'darwin') {
      const r = await executarVoz('say', ['-v', '?'], { fabrica });
      vozes = analisarVozes(r.saida, so);
      if (r.codigo === 0 && vozes.length) tts = 'say';
    } else {
      // Processo de síntese próprio: seu encerramento interrompe o áudio,
      // sem cancelar falas de outros aplicativos no Speech Dispatcher.
      const r = await executarVoz('espeak-ng', ['--voices'], { fabrica });
      if (r.codigo === 0) {
        tts = 'espeak-ng';
        vozes = analisarVozes(r.saida, so);
      }
    }
  } catch {}
  const disponivel = !!ffmpeg && !!whisper && existeModelo && dispositivos.length > 0;
  return {
    ffmpeg,
    whisper,
    modelo,
    tts,
    estado: {
      ...config,
      disponivel,
      gravando: false,
      transcrevendo: false,
      limiteSegundos: 120,
      motivo: disponivel
        ? undefined
        : !ffmpeg || !whisper || !existeModelo
          ? 'Instale os componentes ausentes na seção Voz das configurações.'
          : 'Nenhum microfone encontrado. Verifique as permissões do sistema.',
      componentes,
      dispositivos,
      dispositivo: dispositivos.some((d) => d.id === config.dispositivo)
        ? config.dispositivo
        : dispositivos[0]?.id,
      leitura: {
        ...config.leitura,
        disponivel: !!tts,
        motivo: tts
          ? undefined
          : so === 'linux'
            ? 'Instale eSpeak NG pelo gerenciador de pacotes do sistema para ouvir as mensagens.'
            : 'Nenhuma voz nativa disponível no sistema.',
        vozes,
      },
    },
  };
}
