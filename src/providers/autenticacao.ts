// Conta nativa e chave de API sao fontes distintas. Nunca altera o ambiente do usuario.
const fontesModelo = /^(?:ANTHROPIC_|CLAUDE_CODE_(?:OAUTH_TOKEN|API_KEY|USE_BEDROCK|USE_VERTEX|USE_FOUNDRY)|OPENAI_(?:API_KEY|BASE_URL|AUTH_TOKEN)|CODEX_API_KEY|GEMINI_API_KEY|GOOGLE_(?:API_KEY|GENAI_USE_VERTEXAI|GENAI_USE_GCA)|MISTRAL_API_KEY|VIBE_API_KEY|AZURE_OPENAI_API_KEY|AWS_BEARER_TOKEN_BEDROCK)/i;
export function ambienteConta(origem: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...origem, ELECTRON_RUN_AS_NODE: '1' };
  for (const k of Object.keys(env)) if (fontesModelo.test(k) || /^(NODE_OPTIONS|CLAUDECODE)$/i.test(k)) delete env[k];
  return env;
}
export const settingsContaClaude = JSON.stringify({
  forceLoginMethod: 'claudeai', apiKeyHelper: '',
  env: {
    ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '', CLAUDE_CODE_OAUTH_TOKEN: '',
    ANTHROPIC_PROFILE: '', ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
    CLAUDE_CODE_USE_BEDROCK: '0', CLAUDE_CODE_USE_VERTEX: '0', CLAUDE_CODE_USE_FOUNDRY: '0',
  },
});
export function argsConta(id: string): string[] {
  return id === 'claude' ? ['--settings', settingsContaClaude]
    : id === 'codex' ? ['-c', 'forced_login_method="chatgpt"', '-c', 'model_provider="openai"'] : [];
}
