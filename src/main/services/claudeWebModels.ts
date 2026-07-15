import type { ClaudeWebModel, ClaudeWebStatus } from '@shared/claudeWeb'
import type { ReasoningLevelOption } from '@shared/cliProvider'

type JsonObject = Record<string, unknown>

function asObject(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : undefined
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function firstString(value: JsonObject, keys: string[]): string | undefined {
  for (const key of keys) {
    const result = readString(value[key])
    if (result) return result
  }
  return undefined
}

function parseOptions(value: unknown): ReasoningLevelOption[] {
  if (!Array.isArray(value)) return []

  const options = value.flatMap((item): ReasoningLevelOption[] => {
    const option = asObject(item)
    const effort = option && firstString(option, ['id', 'value'])
    if (!effort) return []
    return [
      {
        effort,
        description: firstString(option, ['name', 'description', 'label']) ?? effort
      }
    ]
  })
  return options
}

function parseThinking(
  value: JsonObject
): Pick<ClaudeWebModel, 'reasoningLevels' | 'defaultReasoningLevel' | 'supportsThinking'> {
  const thinking = asObject(value.thinking)
  const type = thinking && readString(thinking.type)
  if (!thinking || !type || type === 'none') return { supportsThinking: false }

  if (type === 'effort_and_mode') {
    const reasoningLevels = parseOptions(thinking.effort_options)
    return {
      supportsThinking: true,
      reasoningLevels: reasoningLevels.length > 0 ? reasoningLevels : undefined,
      defaultReasoningLevel: readString(thinking.effort)
    }
  }

  if (type === 'mode') {
    return { supportsThinking: true }
  }

  return { supportsThinking: true }
}

function parseModel(value: unknown): ClaudeWebModel | undefined {
  const model = asObject(value)
  if (!model) return undefined
  const id = firstString(model, ['id', 'model'])
  if (!id?.startsWith('claude-')) return undefined
  if (
    model.inactive === true ||
    model.hidden === true ||
    model.disabled === true ||
    model.locked === true ||
    model.requiresUpgrade === true ||
    model.requires_upgrade === true ||
    model.enabled === false ||
    model.available === false ||
    readString(model.section) === 'deprecated'
  ) {
    return undefined
  }

  return {
    id,
    name: firstString(model, ['name', 'display_name', 'displayName']) ?? id,
    description: firstString(model, ['description', 'summary', 'subtitle']),
    supportsVision: true,
    ...parseThinking(model)
  }
}

function selectorModels(root: JsonObject): ClaudeWebModel[] {
  if (!Array.isArray(root.model_selector_config)) return []
  const chat = root.model_selector_config.map(asObject).find((config) => config && readString(config.id) === 'chat')
  return Array.isArray(chat?.models) ? chat.models.flatMap((model) => parseModel(model) ?? []) : []
}

function bootstrapModels(root: JsonObject): ClaudeWebModel[] {
  const account = asObject(root.account)
  if (!Array.isArray(account?.memberships)) return []

  return account.memberships.flatMap((membership) => {
    const organization = asObject(asObject(membership)?.organization)
    const models = organization?.claude_ai_bootstrap_models_config
    return Array.isArray(models) ? models.flatMap((model) => parseModel(model) ?? []) : []
  })
}

export function parseClaudeWebAccount(value: unknown): Omit<ClaudeWebStatus, 'available'> {
  const root = asObject(value)
  const account = root && asObject(root.account)
  const membership = Array.isArray(account?.memberships) ? asObject(account.memberships[0]) : undefined
  const organization = membership && asObject(membership.organization)
  const capabilities = Array.isArray(organization?.capabilities) ? organization.capabilities : []
  const capabilityPlan = capabilities.find((item) => typeof item === 'string' && item.startsWith('claude_'))
  const rawPlan =
    (typeof capabilityPlan === 'string' ? capabilityPlan : undefined) ??
    firstString(organization ?? {}, ['rate_limit_tier', 'billing_type']) ??
    ''
  const normalizedPlan = rawPlan
    .replace(/^claude_/, '')
    .replaceAll('_', ' ')
    .trim()

  return {
    email: firstString(account ?? {}, ['email_address', 'email']) ?? '',
    plan: normalizedPlan ? normalizedPlan.replace(/\b\w/g, (letter) => letter.toUpperCase()) : ''
  }
}

export function parseClaudeWebModels(value: unknown): ClaudeWebModel[] {
  const root = asObject(value)
  if (!root) return []
  const models = selectorModels(root)
  const selected = models.length > 0 ? models : bootstrapModels(root)
  const allowedModels = collectTierAllowedModels(root)
  const seen = new Set<string>()
  return selected.filter((model) => {
    if (allowedModels && !allowedModels.has(model.id)) return false
    if (seen.has(model.id)) return false
    seen.add(model.id)
    return true
  })
}

export function resolveClaudeWebThinking(
  model: ClaudeWebModel,
  requestedEffort?: unknown
): { thinkingMode: 'auto' | 'off'; effort?: string } {
  if (!model.supportsThinking) return { thinkingMode: 'off' }

  const allowedEfforts = new Set(model.reasoningLevels?.map((option) => option.effort) ?? [])
  const requested = typeof requestedEffort === 'string' ? requestedEffort : undefined
  const effort =
    (requested && allowedEfforts.has(requested) ? requested : undefined) ??
    (model.defaultReasoningLevel && allowedEfforts.has(model.defaultReasoningLevel)
      ? model.defaultReasoningLevel
      : undefined)

  return effort ? { thinkingMode: 'auto', effort } : { thinkingMode: 'auto' }
}

function collectTierAllowedModels(root: JsonObject): Set<string> | undefined {
  const { plan } = parseClaudeWebAccount(root)
  const currentRank = tierRank(plan)
  const allowed = new Set<string>()
  let foundTierConfig = false

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      const tierEntries = value.map(asObject).filter((item): item is JsonObject => !!item)
      if (tierEntries.some((item) => readString(item.model_id) && readString(item.minimum_tier))) {
        foundTierConfig = true
        for (const item of tierEntries) {
          const modelId = readString(item.model_id)
          const minimumTier = readString(item.minimum_tier)
          if (modelId && minimumTier && tierRank(minimumTier) <= currentRank) allowed.add(modelId)
        }
      }
      value.forEach(visit)
      return
    }
    const object = asObject(value)
    if (object) Object.values(object).forEach(visit)
  }

  visit(root)
  return foundTierConfig ? allowed : undefined
}

function tierRank(value: string): number {
  const tier = value.toLowerCase().replaceAll(/[-_ ]/g, '')
  if (tier.includes('enterprise')) return 4
  if (tier.includes('business') || tier.includes('team')) return 3
  if (tier.includes('max')) return 2
  if (tier.includes('pro')) return 1
  return 0
}
