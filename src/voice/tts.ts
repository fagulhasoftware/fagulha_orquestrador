export type ProvedorTts = 'openai' | 'elevenlabs' | 'gemini';
export interface VozTts {
  id: string;
  nome: string;
}
export interface ModeloTts {
  id: string;
  nome: string;
  vozes?: string[];
}
export interface CatalogoTts {
  vozes: VozTts[];
  modelos: ModeloTts[];
  nota?: string;
}
export interface AudioTts {
  dados: Buffer;
  mime: 'audio/wav' | 'audio/mpeg';
}
export interface PedidoTts {
  texto: string;
  voz: string;
  modelo: string;
  sinal: AbortSignal;
}
export interface ProvedorSintese {
  catalogo(chave: string): Promise<CatalogoTts>;
  sintetizar(chave: string, pedido: PedidoTts): Promise<AudioTts>;
}
export const VOZES_REALTIME = [
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'sage',
  'shimmer',
  'verse',
  'marin',
  'cedar',
];
export const VOZES_SPEECH = [...VOZES_REALTIME, 'fable', 'nova', 'onyx'];
export const VOZES_GEMINI = [
  'Zephyr',
  'Puck',
  'Charon',
  'Kore',
  'Fenrir',
  'Leda',
  'Orus',
  'Aoede',
  'Callirrhoe',
  'Autonoe',
  'Enceladus',
  'Iapetus',
  'Umbriel',
  'Algieba',
  'Despina',
  'Erinome',
  'Algenib',
  'Rasalgethi',
  'Laomedeia',
  'Achernar',
  'Alnilam',
  'Schedar',
  'Gacrux',
  'Pulcherrima',
  'Achird',
  'Zubenelgenubi',
  'Vindemiatrix',
  'Sadachbia',
  'Sadaltager',
  'Sulafat',
];
export async function lerAudioLimitado(r: Response, limite = 20 * 1024 * 1024): Promise<Buffer> {
  if (!r.body) throw Error('Resposta vazia do provedor de voz.');
  const reader = r.body.getReader(),
    partes: Buffer[] = [];
  let tamanho = 0;
  try {
    for (;;) {
      const p = await reader.read();
      if (p.done) break;
      tamanho += p.value.length;
      if (tamanho > limite) throw Error('Audio excede o limite.');
      partes.push(Buffer.from(p.value));
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return Buffer.concat(partes);
}
export function wavPcm(pcm: Buffer, taxa = 24000): Buffer {
  if (!pcm.length || pcm.length % 2) throw Error('PCM de voz invalido.');
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(pcm.length + 36, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(taxa, 24);
  h.writeUInt32LE(taxa * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
export function validarAudio(audio: AudioTts): AudioTts {
  if (audio.dados.length < 12) throw Error('Provedor retornou audio vazio ou invalido.');
  if (
    audio.mime === 'audio/wav' &&
    (audio.dados.toString('ascii', 0, 4) !== 'RIFF' ||
      audio.dados.toString('ascii', 8, 12) !== 'WAVE')
  )
    throw Error('Cabecalho WAV invalido.');
  if (
    audio.mime === 'audio/mpeg' &&
    audio.dados.toString('ascii', 0, 3) !== 'ID3' &&
    !(audio.dados[0] === 255 && (audio.dados[1] & 224) === 224)
  )
    throw Error('Cabecalho MP3 invalido.');
  return audio;
}
