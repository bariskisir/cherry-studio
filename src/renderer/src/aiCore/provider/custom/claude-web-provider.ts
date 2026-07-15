import { AnthropicMessagesLanguageModel } from '@ai-sdk/anthropic/internal'
import type { LanguageModelV3, ProviderV3 } from '@ai-sdk/provider'

import { claudeWebFetch } from './claude-web-fetch'

export interface ClaudeWebProvider extends ProviderV3 {
  (modelId: string): LanguageModelV3
  languageModel(modelId: string): LanguageModelV3
}

export interface ClaudeWebProviderSettings {
  providerId: string
}

export function createClaudeWeb(options: ClaudeWebProviderSettings = { providerId: 'claude-web' }): ClaudeWebProvider {
  const createModel = (modelId: string) =>
    new AnthropicMessagesLanguageModel(modelId, {
      provider: 'claude-web',
      baseURL: 'https://claude.ai',
      headers: () => ({}),
      fetch: (input, init) => claudeWebFetch(options.providerId, input, init),
      supportedUrls: () => ({})
    })

  const provider = (modelId: string) => createModel(modelId)
  provider.specificationVersion = 'v3' as const
  provider.languageModel = createModel
  provider.embeddingModel = (modelId: string) => {
    throw new Error(`Claude Web does not support embedding model ${modelId}.`)
  }
  provider.imageModel = (modelId: string) => {
    throw new Error(`Claude Web does not support image model ${modelId}.`)
  }
  return provider as ClaudeWebProvider
}
