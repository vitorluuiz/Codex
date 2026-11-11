export function formatAiErrorMessage(code: string, fallbackMessage?: string): string {
  switch (code) {
    case 'AI_QUOTA_EXCEEDED':
      return fallbackMessage || 'Você atingiu o limite de uso de IA do seu plano neste período.';
    case 'AI_BUSY':
      return 'O modelo de IA está atendendo outra solicitação no momento. Aguarde alguns instantes e tente novamente.';
    case 'AI_PROVIDER_UNAVAILABLE':
      return 'O serviço de IA está temporariamente indisponível. Tente novamente em instantes ou continue manualmente.';
    case 'AI_INVALID_OUTPUT':
      return 'A IA retornou um formato inesperado. Tente gerar novamente ou ajuste as instruções.';
    case 'AI_NOT_CONFIGURED':
      return 'A geração por IA não está configurada neste ambiente.';
    case 'VALIDATION_ERROR':
      return fallbackMessage || 'Verifique os campos preenchidos antes de gerar com IA.';
    default:
      return fallbackMessage || 'Não foi possível concluir a geração com IA agora.';
  }
}
