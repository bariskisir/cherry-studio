import { describe, expect, it } from 'vitest'

import { parseClaudeWebAccount, parseClaudeWebModels, resolveClaudeWebThinking } from '../claudeWebModels'

describe('claudeWebModels', () => {
  it('reads models and effort options from the Claude bootstrap response', () => {
    const response = {
      account: {
        email_address: 'user@example.com',
        memberships: [{ organization: { capabilities: ['claude_max'] } }]
      },
      model_selector_config: [
        {
          id: 'chat',
          models: [
            {
              id: 'claude-opus-test',
              name: 'Claude Opus Test',
              description: 'Test model',
              thinking: {
                type: 'effort_and_mode',
                effort: 'medium',
                effort_options: [
                  { id: 'low', name: 'Fast' },
                  { id: 'medium', name: 'Balanced' },
                  { id: 'max', name: 'Deepest' }
                ]
              }
            }
          ]
        }
      ]
    }

    expect(parseClaudeWebModels(response)).toEqual([
      {
        id: 'claude-opus-test',
        name: 'Claude Opus Test',
        description: 'Test model',
        supportsVision: true,
        supportsThinking: true,
        reasoningLevels: [
          { effort: 'low', description: 'Fast' },
          { effort: 'medium', description: 'Balanced' },
          { effort: 'max', description: 'Deepest' }
        ],
        defaultReasoningLevel: 'medium'
      }
    ])
    expect(parseClaudeWebAccount(response)).toEqual({ email: 'user@example.com', plan: 'Max' })
  })

  it('does not invent effort levels when the server omits them', () => {
    const response = {
      model_selector_config: [
        { id: 'chat', models: [{ id: 'claude-sonnet-test', thinking: { type: 'effort_and_mode' } }] }
      ]
    }

    expect(parseClaudeWebModels(response)[0]).toMatchObject({
      id: 'claude-sonnet-test',
      supportsThinking: true,
      reasoningLevels: undefined,
      defaultReasoningLevel: undefined
    })
  })

  it('filters models using the account tier allowlist returned by the server', () => {
    const response = {
      account: {
        memberships: [{ organization: { capabilities: ['claude_auto_api_evaluation'] } }]
      },
      model_selector_config: [
        {
          id: 'chat',
          models: [{ id: 'claude-free' }, { id: 'claude-pro' }]
        }
      ],
      model_tiers: [
        { model_id: 'claude-free', minimum_tier: 'free' },
        { model_id: 'claude-pro', minimum_tier: 'pro' }
      ]
    }

    expect(parseClaudeWebModels(response).map((model) => model.id)).toEqual(['claude-free'])
  })

  it('always enables thinking and selects only server-provided effort levels', () => {
    const model = {
      id: 'claude-sonnet-test',
      name: 'Claude Sonnet Test',
      supportsThinking: true,
      reasoningLevels: [
        { effort: 'low', description: 'Low' },
        { effort: 'high', description: 'High' }
      ],
      defaultReasoningLevel: 'high'
    }

    expect(resolveClaudeWebThinking(model)).toEqual({ thinkingMode: 'auto', effort: 'high' })
    expect(resolveClaudeWebThinking(model, 'low')).toEqual({ thinkingMode: 'auto', effort: 'low' })
    expect(resolveClaudeWebThinking(model, 'invented')).toEqual({ thinkingMode: 'auto', effort: 'high' })
    expect(resolveClaudeWebThinking({ ...model, supportsThinking: false }, 'high')).toEqual({ thinkingMode: 'off' })
  })
})
