import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { EstadoVoz } from '../shared/protocolo';

const esquema = z.object({
  dispositivo: z.string().max(500).optional(),
  modelo: z.enum(['base', 'small', 'medium']).default('small'),
  idioma: z.enum(['pt', 'en', 'es', 'auto']).default('pt'),
  envioAutomatico: z.boolean().default(false),
  leitura: z
    .object({
      ativa: z.boolean().default(false),
      voz: z.string().max(200).optional(),
      velocidade: z.number().min(0.5).max(2).default(1),
      motor: z.enum(['sistema', 'piper', 'nuvem']).optional(),
      variacao: z.number().min(0).max(1).default(0.5),
      provedor: z.enum(['openai', 'elevenlabs']).optional(),
      vozesNuvem: z
        .array(z.object({ id: z.string().max(200), nome: z.string().max(200) }))
        .max(100)
        .default([]),
    })
    .default({}),
});
export type ConfiguracaoVoz = z.infer<typeof esquema>;
export type ParcialVoz = Partial<Omit<ConfiguracaoVoz, 'leitura'>> & {
  leitura?: Partial<ConfiguracaoVoz['leitura']>;
};
export function padraoVoz(): ConfiguracaoVoz {
  return esquema.parse({});
}
export function estadoInicialVoz(): EstadoVoz {
  return {
    ...padraoVoz(),
    disponivel: false,
    motivo: 'Componentes de voz aguardando detecção.',
    gravando: false,
    transcrevendo: false,
    limiteSegundos: 120,
    componentes: [],
    dispositivos: [],
    leitura: {
      ...padraoVoz().leitura,
      motor: 'sistema',
      disponivel: false,
      vozes: [],
      motores: [],
      nuvem: { provedor: null, chaveConfigurada: false },
    },
  };
}
export async function carregarConfiguracao(arquivo: string): Promise<ConfiguracaoVoz> {
  try {
    return esquema.parse(JSON.parse(await readFile(arquivo, 'utf8')));
  } catch {
    return padraoVoz();
  }
}
export async function salvarConfiguracao(arquivo: string, config: ConfiguracaoVoz): Promise<void> {
  const validada = esquema.parse(config);
  await mkdir(dirname(arquivo), { recursive: true, mode: 0o700 });
  const temporario = arquivo + '.' + randomUUID() + '.parcial';
  try {
    await writeFile(temporario, JSON.stringify(validada), { mode: 0o600 });
    await rename(temporario, arquivo);
  } finally {
    await rm(temporario, { force: true });
  }
}
