export const diagnosticos = {
  variaveis_ausentes: 'Variaveis da ponte ausentes no processo do servidor MCP.',
  endereco_invalido: 'Endereco da ponte invalido no processo do servidor MCP.',
  token_recusado: 'Ponte recusou o token (execucao encerrada).',
  acao_negada_usuario: 'Acao negada pelo usuario no cartao de aprovacao da sala.',
  modo_recusado:
    'Acao recusada pelo modo do agente. Confira Leitura, Escrita ou Leitura e escrita na sala.',
  aprovacao_expirada: 'O cartao de aprovacao expirou sem resposta do usuario.',
  execucao_encerrada: 'Execucao encerrada ou interrompida na sala.',
  argumentos_invalidos: 'Argumentos invalidos para a ferramenta do Orquestrador.',
  tempo_esgotado: 'Tempo de resposta da ponte esgotado.',
  requisicao_recusada: 'Requisicao recusada pela ponte local.',
  ponte_indisponivel: 'Nao foi possivel conectar a ponte local da execucao.',
  ferramenta_falhou: 'A ferramenta falhou no host. Confira os avisos na sala.',
} as const;
export type CodigoDiagnostico = keyof typeof diagnosticos;
export function codigoSeguro(valor: unknown): CodigoDiagnostico | undefined {
  return typeof valor === 'string' && Object.hasOwn(diagnosticos, valor)
    ? (valor as CodigoDiagnostico)
    : undefined;
}
