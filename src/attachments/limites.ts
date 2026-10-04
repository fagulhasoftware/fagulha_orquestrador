import { extname } from 'node:path';
import type { Anexo, Configuracao } from '../shared/protocolo';
import { limitar } from '../core/configuracao';
export function classificar(
  nome: string,
  bytes: number,
  config?: Partial<Configuracao['limites']>,
): Pick<Anexo, 'tipo' | 'tratamento' | 'aviso'> {
  const limites = limitar(config),
    ext = extname(nome).toLowerCase(),
    MB = 1024 * 1024;
  const planilha =
    ['.xlsx', '.xlsm', '.xlsb', '.xls', '.ods', '.tsv'].includes(ext) ||
    (ext === '.csv' && bytes > 512 * 1024);
  const tipo: Anexo['tipo'] = planilha
    ? 'planilha'
    : ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)
      ? 'imagem'
      : ext === '.pdf'
        ? 'pdf'
        : ext === '.docx'
          ? 'docx'
          : [
                '.txt',
                '.md',
                '.json',
                '.yaml',
                '.yml',
                '.xml',
                '.html',
                '.log',
                '.csv',
                '.ts',
                '.tsx',
                '.js',
                '.jsx',
                '.py',
                '.rs',
                '.go',
                '.java',
                '.c',
                '.cpp',
                '.h',
                '.css',
                '.sql',
                '.sh',
                '.ps1',
              ].includes(ext)
            ? 'texto'
            : 'outro';
  const max =
    tipo === 'planilha'
      ? limites.planilhaMaxMB
      : tipo === 'imagem'
        ? limites.imagemMaxMB
        : ['pdf', 'docx'].includes(tipo)
          ? limites.documentoMaxMB
          : limites.textoMaxMB;
  if (bytes > max * MB)
    return {
      tipo,
      tratamento: 'recusado',
      aviso: `Arquivo excede o limite de ${max} MB${tipo === 'planilha' ? '; planilhas nunca sao lidas integralmente' : ''}.`,
    };
  if (planilha && ['.xls', '.xlsb', '.ods'].includes(ext))
    return {
      tipo,
      tratamento: 'recusado',
      aviso: 'Formato sem parser streaming nesta F1. Converta localmente para xlsx ou CSV.',
    };
  if (planilha)
    return {
      tipo,
      tratamento: 'amostra',
      aviso: `Amostra: ate ${limites.planilhaAbas} abas, cabecalho + ${limites.planilhaLinhasPorAba} linhas por aba.`,
    };
  if (tipo === 'texto' && bytes > limites.textoIntegralKB * 1024)
    return {
      tipo,
      tratamento: 'amostra',
      aviso: `Somente os primeiros ${limites.textoIntegralKB} KB.`,
    };
  if (tipo === 'outro')
    return { tipo, tratamento: 'metadados', aviso: 'Formato nao interpretado; somente metadados.' };
  if (tipo === 'pdf')
    return {
      tipo,
      tratamento: 'amostra',
      aviso: 'Texto das primeiras 50 paginas, limitado a 512 KB.',
    };
  return { tipo, tratamento: 'integral' };
}
