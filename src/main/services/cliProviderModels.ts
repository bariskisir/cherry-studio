import type { CliProviderModel, ReasoningLevelOption } from '@shared/cliProvider'

type JsonObject = Record<string, unknown>

const CLAUDE_REASONING_DESCRIPTIONS: Record<string, string> = {
  low: 'Fast responses with lighter reasoning',
  medium: 'Balanced reasoning for everyday tasks',
  high: 'Greater reasoning depth for complex tasks',
  xhigh: 'Extra high reasoning depth for complex tasks',
  max: 'Maximum reasoning depth for the most complex tasks'
}

function asObject(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : undefined
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function readFirstString(source: JsonObject, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = readString(source[key])
    if (value) return value
  }
  return undefined
}

function parseCodexReasoningLevels(value: unknown): ReasoningLevelOption[] | undefined {
  if (!Array.isArray(value)) return undefined

  const levels = value.flatMap((item): ReasoningLevelOption[] => {
    const level = asObject(item)
    const effort = level && readString(level.effort)
    const description = level && readString(level.description)
    return effort && description ? [{ effort, description }] : []
  })

  return levels.length > 0 ? levels : undefined
}

export function parseCodexModelsResponse(value: unknown): CliProviderModel[] {
  const data = asObject(value)
  if (!Array.isArray(data?.models)) return []

  return data.models.flatMap((item): CliProviderModel[] => {
    const model = asObject(item)
    if (!model) return []

    const id = readFirstString(model, ['slug', 'model', 'id'])
    if (!id || /auto[-_]review/i.test(id)) return []

    return [
      {
        id,
        name: readFirstString(model, ['display_name', 'displayName']) ?? id,
        reasoningLevels: parseCodexReasoningLevels(model.supported_reasoning_levels),
        defaultReasoningLevel: readString(model.default_reasoning_level)
      }
    ]
  })
}

function parseClaudeReasoning(value: unknown): Pick<CliProviderModel, 'reasoningLevels' | 'defaultReasoningLevel'> {
  const capabilities = asObject(value)
  const effortCapability = asObject(capabilities?.effort)
  if (effortCapability?.supported !== true) return {}

  const reasoningLevels = Object.entries(effortCapability).flatMap(([effort, capability]): ReasoningLevelOption[] => {
    if (effort === 'supported' || asObject(capability)?.supported !== true) return []
    return [{ effort, description: CLAUDE_REASONING_DESCRIPTIONS[effort] ?? effort }]
  })

  if (reasoningLevels.length === 0) return {}
  return {
    reasoningLevels,
    defaultReasoningLevel: reasoningLevels.at(-1)?.effort
  }
}

export interface ClaudeModelsPage {
  models: CliProviderModel[]
  nextAfterId?: string
}

export function parseClaudeModelsResponse(value: unknown): ClaudeModelsPage {
  const data = asObject(value)
  const items = Array.isArray(data?.data) ? data.data : []
  const models = items.flatMap((item): CliProviderModel[] => {
    const model = asObject(item)
    const id = model && readString(model.id)
    if (!model || !id) return []

    return [
      {
        id,
        name: readString(model.display_name) ?? id,
        ...parseClaudeReasoning(model.capabilities)
      }
    ]
  })

  const lastId = data?.has_more === true ? readString(data.last_id) : undefined
  return { models, nextAfterId: lastId }
}

export function parseAntigravityModelsResponse(value: unknown): CliProviderModel[] | undefined {
  const data = asObject(value)
  const models = asObject(data?.models)
  if (!models) return undefined

  return Object.entries(models).flatMap(([id, value]): CliProviderModel[] => {
    const model = asObject(value)
    if (model?.isInternal === true) return []

    return [
      {
        id,
        name: readString(model?.displayName) ?? id,
        supportsThinking: model?.supportsThinking === true
      }
    ]
  })
}
