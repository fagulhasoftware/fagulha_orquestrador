import type { ComponenteVoz, ModeloVoz } from '../shared/protocolo';

export interface ArtefatoVoz {
  componente: ComponenteVoz;
  nome: string;
  url: string;
  sha256: string;
  tamanhoBytes: number;
  arquivo: string;
  zip?: boolean;
  licenca?: boolean;
}
const revisao = '5359861c739e955e79d9a303bcbc70fb988958b1';
// A licenca de cada voz inclui a origem do modelo-base (ver Rodada 12).
export const VOZES_COMERCIAIS: readonly {
  id: string;
  nome: string;
  modelo: ArtefatoVoz;
  config: ArtefatoVoz;
  licenca: string;
  fonte: string;
}[] = [];
export const PIPER: ArtefatoVoz = {
  componente: 'piper',
  nome: 'Piper 2023.11.14-2 (Windows x64)',
  url: 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip',
  sha256: 'f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea',
  tamanhoBytes: 22477236,
  arquivo: 'piper-2023.11.14-2.zip',
  zip: true,
};
export const LICENCAS_PIPER: ArtefatoVoz[] = [
  {
    componente: 'piper',
    nome: 'Licenca MIT do Piper',
    url: 'https://raw.githubusercontent.com/rhasspy/piper/2023.11.14-2/LICENSE.md',
    sha256: '4cd71dece7037f1d6d93cce7570c57ab75ea9ac566fd4990be2f3ab08d15b47f',
    tamanhoBytes: 1071,
    arquivo: 'piper-MIT.txt',
    licenca: true,
  },
  {
    componente: 'piper',
    nome: 'Licenca GPL-3 do eSpeak NG',
    url: 'https://raw.githubusercontent.com/espeak-ng/espeak-ng/1.51.1/COPYING',
    sha256: '8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903',
    tamanhoBytes: 35147,
    arquivo: 'espeak-GPL3.txt',
    licenca: true,
  },
  {
    componente: 'piper',
    nome: 'Licenca MIT do ONNX Runtime',
    url: 'https://raw.githubusercontent.com/microsoft/onnxruntime/v1.16.2/LICENSE',
    sha256: '2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c',
    tamanhoBytes: 1073,
    arquivo: 'onnxruntime-MIT.txt',
    licenca: true,
  },
];
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
  if (componente === 'piper') return PIPER;
  if (componente === 'voz_neural')
    throw new Error(
      'Ainda nao ha uma voz pt_BR com licenca comercial e origem verificadas no catalogo. Use a voz do sistema ou nuvem opcional.',
    );
  return componente === 'ffmpeg' ? FFMPEG : componente === 'whisper' ? WHISPER : MODELOS[modelo];
}
