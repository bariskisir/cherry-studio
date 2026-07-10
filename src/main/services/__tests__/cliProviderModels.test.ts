import { describe, expect, it } from 'vitest'

import {
  parseAntigravityModelsResponse,
  parseClaudeModelsResponse,
  parseCodexModelsResponse
} from '../cliProviderModels'

describe('parseCodexModelsResponse', () => {
  it('normalizes model identifiers and reasoning metadata', () => {
    expect(
      parseCodexModelsResponse({
        models: [
          {
            slug: 'gpt-5.2-codex',
            display_name: 'GPT-5.2 Codex',
            supported_reasoning_levels: [
              { effort: 'low', description: 'Fast' },
              { effort: '', description: 'Invalid' }
            ],
            default_reasoning_level: 'low'
          },
          { id: 'codex-auto-review' },
          { display_name: 'Missing id' }
        ]
      })
    ).toEqual([
      {
        id: 'gpt-5.2-codex',
        name: 'GPT-5.2 Codex',
        reasoningLevels: [{ effort: 'low', description: 'Fast' }],
        defaultReasoningLevel: 'low'
      }
    ])
  })

  it('returns an empty list for malformed responses', () => {
    expect(parseCodexModelsResponse(null)).toEqual([])
    expect(parseCodexModelsResponse({ models: {} })).toEqual([])
  })
})

describe('parseClaudeModelsResponse', () => {
  it('normalizes supported effort capabilities and pagination', () => {
    expect(
      parseClaudeModelsResponse({
        data: [
          {
            id: 'claude-opus-4-6',
            display_name: 'Claude Opus 4.6',
            capabilities: {
              effort: {
                supported: true,
                low: { supported: true },
                high: { supported: true },
                experimental: { supported: false }
              }
            }
          }
        ],
        has_more: true,
        last_id: 'next-page'
      })
    ).toEqual({
      models: [
        {
          id: 'claude-opus-4-6',
          name: 'Claude Opus 4.6',
          reasoningLevels: [
            { effort: 'low', description: 'Fast responses with lighter reasoning' },
            { effort: 'high', description: 'Greater reasoning depth for complex tasks' }
          ],
          defaultReasoningLevel: 'high'
        }
      ],
      nextAfterId: 'next-page'
    })
  })

  it('omits reasoning metadata when effort control is unsupported', () => {
    expect(
      parseClaudeModelsResponse({ data: [{ id: 'claude-sonnet', capabilities: { effort: { supported: false } } }] })
    ).toEqual({ models: [{ id: 'claude-sonnet', name: 'claude-sonnet' }], nextAfterId: undefined })
  })
})

describe('parseAntigravityModelsResponse', () => {
  it('filters internal models and preserves thinking support', () => {
    expect(
      parseAntigravityModelsResponse({
        models: {
          'gemini-pro': { displayName: 'Gemini Pro', supportsThinking: true },
          hidden: { isInternal: true }
        }
      })
    ).toEqual([{ id: 'gemini-pro', name: 'Gemini Pro', supportsThinking: true }])
  })

  it('distinguishes a missing model catalog from an empty one', () => {
    expect(parseAntigravityModelsResponse({})).toBeUndefined()
    expect(parseAntigravityModelsResponse({ models: {} })).toEqual([])
  })
})
