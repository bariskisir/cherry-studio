import { loggerService } from '@logger'
import { listModels } from '@renderer/aiCore/services/listModels'
import { useProvider } from '@renderer/hooks/useProvider'
import type { ClaudeWebStatus } from '@shared/claudeWeb'
import { Alert, Button } from 'antd'
import { type FC, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Container, DetailRow } from './shared/styled'

const logger = loggerService.withContext('ClaudeWebSettings')
const SIGNED_OUT: ClaudeWebStatus = { available: false, email: '', plan: '' }

interface Props {
  providerId: string
}

const ClaudeWebSettings: FC<Props> = ({ providerId }) => {
  const { t } = useTranslation()
  const { provider, updateProvider } = useProvider(providerId)
  const [status, setStatus] = useState<ClaudeWebStatus>(SIGNED_OUT)
  const [loading, setLoading] = useState(true)

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await window.api.claudeWeb.getStatus(providerId))
    } catch (error) {
      logger.error('Failed to read Claude Web sign-in status', error as Error)
      setStatus(SIGNED_OUT)
    } finally {
      setLoading(false)
    }
  }, [providerId])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  const handleLogin = async () => {
    setLoading(true)
    try {
      const nextStatus = await window.api.claudeWeb.startLogin(providerId)
      const models = await listModels(provider)
      setStatus(nextStatus)
      updateProvider({ enabled: true, models })
      window.toast.success(t('settings.provider.claude_web.login_success'))
    } catch (error) {
      logger.error('Claude Web sign-in failed', error as Error)
      window.toast.error(t('settings.provider.claude_web.login_failed'))
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = async () => {
    setLoading(true)
    try {
      await window.api.claudeWeb.logout(providerId)
      setStatus(SIGNED_OUT)
      updateProvider({ enabled: false, models: [] })
      window.toast.success(t('settings.provider.claude_web.logout_success'))
    } catch (error) {
      logger.error('Claude Web sign-out failed', error as Error)
      window.toast.error(t('settings.provider.claude_web.logout_failed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Container>
      <Alert
        type="warning"
        showIcon
        message={t('settings.provider.claude_code.warning')}
        style={{ marginBottom: 10 }}
      />
      <Alert
        type={status.available ? 'success' : 'info'}
        showIcon
        message={
          status.available
            ? t('settings.provider.claude_web.signed_in')
            : t('settings.provider.claude_web.not_signed_in')
        }
        description={
          status.available ? (
            <>
              {status.email ? <DetailRow>{status.email}</DetailRow> : null}
              {status.plan ? (
                <DetailRow>{t('settings.provider.claude_web.plan', { plan: status.plan })}</DetailRow>
              ) : null}
            </>
          ) : null
        }
        action={
          <Button type="primary" loading={loading} onClick={status.available ? handleLogout : handleLogin}>
            {status.available ? t('settings.provider.claude_web.logout') : t('settings.provider.claude_web.login')}
          </Button>
        }
      />
    </Container>
  )
}

export default ClaudeWebSettings
