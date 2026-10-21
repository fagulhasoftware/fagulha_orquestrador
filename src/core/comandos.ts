export const comandosSala = [
  { valor: 'reiniciar-contexto', rotulo: 'Reiniciar contexto: /reiniciar-contexto @agente' },
  {
    valor: 'pausar',
    rotulo: 'Interromper a execucao atual; /continuar retoma o agente pelo contexto',
  },
  { valor: 'continuar', rotulo: 'Retomar o agente pausado pelo contexto da sala' },
  { valor: 'parar', rotulo: 'Interromper execucao e limpar fila' },
  { valor: 'integracoes', rotulo: 'Abrir conexoes MCP compartilhadas' },
  { valor: 'skills', rotulo: 'Abrir skills instaladas' },
  { valor: 'agentes', rotulo: 'Gerenciar participantes' },
  { valor: 'configuracoes', rotulo: 'Abrir configuracoes da sala' },
  { valor: 'memorias', rotulo: 'Abrir memorias' },
  { valor: 'novo', rotulo: 'Criar nova conversa' },
  { valor: 'ajuda', rotulo: 'Mostrar @participantes, #especialistas e comandos /' },
];
export function termoComposer(texto: string, posicao: number) {
  const ate = texto.slice(0, posicao);
  const m = ate.match(/(^|\s)([@#/])([\p{L}\p{N}_:-]*)$/u);
  return m
    ? { inicio: ate.length - m[3].length - 1, termo: m[3].toLowerCase(), prefixo: m[2] }
    : null;
}
