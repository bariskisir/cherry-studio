import { ActionIconButton } from '@renderer/components/Buttons'
import {
  MdiLightbulbAutoOutline,
  MdiLightbulbOffOutline,
  MdiLightbulbOn,
  MdiLightbulbOn30,
  MdiLightbulbOn50,
  MdiLightbulbOn80,
  MdiLightbulbOn90,
  MdiLightbulbQuestion
} from '@renderer/components/Icons/SVGIcon'
import { QuickPanelReservedSymbol, useQuickPanel } from '@renderer/components/QuickPanel'
import {
  getThinkModelType,
  isDoubaoThinkingAutoModel,
  isFixedReasoningModel,
  isGPT5SeriesReasoningModel,
  isOpenAIWebSearchModel,
  MODEL_SUPPORTED_OPTIONS
} from '@renderer/config/models'
import { useAssistant } from '@renderer/hooks/useAssistant'
import type { ToolQuickPanelApi } from '@renderer/pages/home/Inputbar/types'
import type { Model, ThinkingOption } from '@renderer/types'
import { Tooltip } from 'antd'
import type { FC, ReactElement } from 'react'
import { useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  quickPanel: ToolQuickPanelApi
  model: Model
  assistantId: string
  // Controlled mode: external state management (for agent sessions)
  reasoningEffort?: ThinkingOption
  onReasoningEffortChange?: (option: ThinkingOption) => void
}

const ThinkingButton: FC<Props> = ({
  quickPanel,
  model,
  assistantId,
  reasoningEffort: controlledEffort,
  onReasoningEffortChange
}): ReactElement => {
  const { t } = useTranslation()
  const quickPanelHook = useQuickPanel()
  const isControlled = controlledEffort !== undefined
  const { assistant, updateAssistantSettings } = useAssistant(assistantId)

  const currentReasoningEffort = useMemo(() => {
    if (isControlled) return controlledEffort
    return assistant.settings?.reasoning_effort || 'none'
  }, [isControlled, controlledEffort, assistant.settings?.reasoning_effort])

  // 确定当前模型支持的选项类型
  const modelType = useMemo(() => getThinkModelType(model), [model])

  const isFixedReasoning = isFixedReasoningModel(model)

  // 获取当前模型支持的选项
  const supportedOptions: ThinkingOption[] = useMemo(() => {
    if (model.reasoningLevels && model.reasoningLevels.length > 0) {
      const levels: ThinkingOption[] = ['none', 'default']
      const added = new Set<string>()
      for (const rl of model.reasoningLevels) {
        if (rl.effort && !added.has(rl.effort)) {
          levels.push(rl.effort as ThinkingOption)
          added.add(rl.effort)
        }
      }
      return levels
    }
    if (modelType === 'doubao') {
      if (isDoubaoThinkingAutoModel(model)) {
        return ['none', 'auto', 'high']
      }
      return ['none', 'high']
    }
    return MODEL_SUPPORTED_OPTIONS[modelType]
  }, [model, modelType])

  const onThinkingChange = useCallback(
    (option: ThinkingOption) => {
      const isEnabled = option !== 'none'

      if (isControlled) {
        onReasoningEffortChange?.(option)
        return
      }

      if (!isEnabled) {
        updateAssistantSettings({
          reasoning_effort: option,
          reasoning_effort_cache: option,
          qwenThinkMode: false
        })
        return
      }
      if (
        isOpenAIWebSearchModel(model) &&
        isGPT5SeriesReasoningModel(model) &&
        assistant.enableWebSearch &&
        option === 'minimal'
      ) {
        window.toast.warning(t('chat.web_search.warning.openai'))
        return
      }
      updateAssistantSettings({
        reasoning_effort: option,
        reasoning_effort_cache: option,
        qwenThinkMode: true
      })
    },
    [isControlled, onReasoningEffortChange, updateAssistantSettings, assistant.enableWebSearch, model, t]
  )

  const getEffortLabel = useCallback(
    (option: ThinkingOption): string => {
      const staticLabels: Record<string, string> = {
        default: t('assistants.settings.reasoning_effort.default'),
        none: t('assistants.settings.reasoning_effort.off'),
        minimal: t('assistants.settings.reasoning_effort.minimal'),
        high: t('assistants.settings.reasoning_effort.high'),
        low: t('assistants.settings.reasoning_effort.low'),
        medium: t('assistants.settings.reasoning_effort.medium'),
        auto: t('assistants.settings.reasoning_effort.auto'),
        xhigh: t('assistants.settings.reasoning_effort.xhigh')
      }
      return staticLabels[option] || option.charAt(0).toUpperCase() + option.slice(1)
    },
    [t]
  )

  const getEffortDescription = useCallback(
    (option: ThinkingOption): string => {
      const staticDescriptions: Record<string, string> = {
        default: t('assistants.settings.reasoning_effort.default_description'),
        none: t('assistants.settings.reasoning_effort.off_description'),
        minimal: t('assistants.settings.reasoning_effort.minimal_description'),
        low: t('assistants.settings.reasoning_effort.low_description'),
        medium: t('assistants.settings.reasoning_effort.medium_description'),
        high: t('assistants.settings.reasoning_effort.high_description'),
        xhigh: t('assistants.settings.reasoning_effort.xhigh_description'),
        auto: t('assistants.settings.reasoning_effort.auto_description')
      }
      if (staticDescriptions[option]) return staticDescriptions[option]
      if (model.reasoningLevels) {
        const rl = model.reasoningLevels.find((l) => l.effort === option)
        if (rl?.description) return rl.description
      }
      return `${option.charAt(0).toUpperCase() + option.slice(1)} reasoning`
    },
    [t, model.reasoningLevels]
  )

  const panelItems = useMemo(() => {
    // 使用表中定义的选项创建UI选项
    return supportedOptions.map((option) => ({
      level: option,
      label: getEffortLabel(option),
      description: getEffortDescription(option),
      icon: ThinkingIcon({ option }),
      isSelected: currentReasoningEffort === option,
      action: () => onThinkingChange(option)
    }))
  }, [supportedOptions, getEffortLabel, getEffortDescription, currentReasoningEffort, onThinkingChange])

  const isThinkingEnabled =
    currentReasoningEffort !== undefined && currentReasoningEffort !== 'none' && currentReasoningEffort !== 'default'

  // Check if model supports multiple thinking levels (not just on/off)
  const hasMultipleLevels = useMemo(() => {
    const effortLevels = supportedOptions.filter((opt) => opt !== 'none' && opt !== 'default' && opt !== 'auto')
    return effortLevels.length > 1
  }, [supportedOptions])

  const disableThinking = useCallback(() => {
    onThinkingChange('none')
  }, [onThinkingChange])

  const openQuickPanel = useCallback(() => {
    quickPanelHook.open({
      title: t('assistants.settings.reasoning_effort.label'),
      list: panelItems,
      symbol: QuickPanelReservedSymbol.Thinking
    })
  }, [quickPanelHook, panelItems, t])

  const handleOpenQuickPanel = useCallback(() => {
    if (isFixedReasoning) return

    if (quickPanelHook.isVisible && quickPanelHook.symbol === QuickPanelReservedSymbol.Thinking) {
      quickPanelHook.close()
      return
    }

    // If model has only single level (doesn't support multiple levels), directly disable thinking
    if (isThinkingEnabled && supportedOptions.includes('none') && !hasMultipleLevels) {
      disableThinking()
      return
    }
    openQuickPanel()
  }, [
    openQuickPanel,
    quickPanelHook,
    isThinkingEnabled,
    supportedOptions,
    hasMultipleLevels,
    disableThinking,
    isFixedReasoning
  ])

  useEffect(() => {
    if (isFixedReasoning) return

    const disposeMenu = quickPanel.registerRootMenu([
      {
        label: t('assistants.settings.reasoning_effort.label'),
        description: '',
        icon: ThinkingIcon({ option: currentReasoningEffort }),
        isMenu: true,
        action: () => openQuickPanel()
      }
    ])

    const disposeTrigger = quickPanel.registerTrigger(QuickPanelReservedSymbol.Thinking, () => openQuickPanel())

    return () => {
      disposeMenu()
      disposeTrigger()
    }
  }, [currentReasoningEffort, openQuickPanel, quickPanel, t, isFixedReasoning])

  // Determine tooltip label, consistent with handleOpenQuickPanel behavior:
  // - Fixed reasoning models: always show "Thinking"
  // - Multi-level models: always show "Reasoning Effort" (opens panel)
  // - Single-level models: show "Close" when thinking enabled, otherwise "Reasoning Effort"
  const ariaLabel = isFixedReasoning
    ? t('chat.input.thinking.label')
    : hasMultipleLevels || !isThinkingEnabled
      ? t('assistants.settings.reasoning_effort.label')
      : t('common.close')

  return (
    <Tooltip placement="top" title={ariaLabel} mouseLeaveDelay={0} arrow>
      <ActionIconButton
        onClick={handleOpenQuickPanel}
        active={isFixedReasoning || currentReasoningEffort !== 'none'}
        aria-label={ariaLabel}
        aria-pressed={currentReasoningEffort !== 'none'}
        style={isFixedReasoning ? { cursor: 'default' } : undefined}>
        {ThinkingIcon({ option: currentReasoningEffort, isFixedReasoning })}
      </ActionIconButton>
    </Tooltip>
  )
}

const ThinkingIcon = (props: { option?: ThinkingOption; isFixedReasoning?: boolean }) => {
  let IconComponent: React.FC<React.SVGProps<SVGSVGElement>> | null = null
  if (props.isFixedReasoning) {
    IconComponent = MdiLightbulbAutoOutline
  } else {
    switch (props.option) {
      case 'minimal':
        IconComponent = MdiLightbulbOn30
        break
      case 'low':
        IconComponent = MdiLightbulbOn50
        break
      case 'medium':
        IconComponent = MdiLightbulbOn80
        break
      case 'high':
        IconComponent = MdiLightbulbOn90
        break
      case 'xhigh':
        IconComponent = MdiLightbulbOn
        break
      case 'auto':
        IconComponent = MdiLightbulbAutoOutline
        break
      case 'none':
        IconComponent = MdiLightbulbOffOutline
        break
      case 'default':
        IconComponent = MdiLightbulbQuestion
        break
      default:
        IconComponent = MdiLightbulbOn
        break
    }
  }

  return <IconComponent className="icon" width={18} height={18} style={{ marginTop: -2 }} />
}

export default ThinkingButton
