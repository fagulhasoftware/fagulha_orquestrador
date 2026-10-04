import type { ComponenteVoz, ModeloVoz } from '../shared/protocolo';

export interface ArtefatoVoz {
  componente: ComponenteVoz;
  nome: string;
  url: string;
  sha256: string;
  tamanhoBytes: number;
  arquivo: string;
  zip?: boolean;
}
const revisao = '5359861c739e955e79d9a303bcbc70fb988958b1';
// SHA-256: GitHub release asset digest / Hugging Face LFS oid, conferidos por download.
export const FFMPEG: ArtefatoVoz = {
  componente: 'ffmpeg',
  nome: 'FFmpeg 9.0.2 (Gyan, Windows x64)',
  url: 'https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.zip',
  sha256: '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba',
  tamanhoBytes: 114768076,
  arquivo: 'ffmpeg-9.0.2.zip',
  zip: true,
};
export const WHISPER: ArtefatoVoz = {
  componente: 'whisper',
  nome: 'whisper.cpp 1.9.2 (Windows x64, CPU)',
  url: 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-bin-x64.zip',
  sha256: '49dcc16de826f20bd53d44f947a1ae49dfa81f86cad67a64d80820cb192d674a',
  tamanhoBytes: 8194445,
  arquivo: 'whisper-1.9.2.zip',
  zip: true,
};
export const MODELOS: Record<ModeloVoz, ArtefatoVoz> = Object.fromEntries(
  [
    ['base', 147951465, '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe'],
    ['small', 487601967, '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b'],
    ['medium', 1533763059, '6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208'],
  ].map(([modelo, tamanhoBytes, sha256]) => [
    modelo,
    {
      componente: 'modelo',
      nome: `Whisper ${modelo}`,
      url: `https://huggingface.co/ggerganov/whisper.cpp/resolve/${revisao}/ggml-${modelo}.bin`,
      sha256,
      tamanhoBytes,
      arquivo: `ggml-${modelo}.bin`,
    },
  ]),
) as Record<ModeloVoz, ArtefatoVoz>;
export function artefato(componente: ComponenteVoz, modelo: ModeloVoz): ArtefatoVoz {
  return componente === 'ffmpeg' ? FFMPEG : componente === 'whisper' ? WHISPER : MODELOS[modelo];
}
