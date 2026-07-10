import { CheckCircleOutlined, ExclamationCircleOutlined } from '@ant-design/icons'
import type { ClaudeCodeQuota } from '@shared/cliProvider'
import { Alert, Button, Switch } from 'antd'
import { type FC, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Container,
  DetailRow,
  FilePathInput,
  FilePathRow,
  OptionLabel,
  OptionRow,
  OptionsCard,
  ProgressRow,
  StretchProgress,
  UsageContainer
} from './shared/styled'
import { useProviderQuota } from './shared/useProviderQuota'
import { formatExpiry, formatReset, loadPersisted, loadPersistedBoolean, persist, selectJsonFile } from './shared/utils'

const LS_AUTH_PATH = 'claude-code-auth-path'
const LS_REFRESH_TOKEN = 'claude-code-refresh-token'
const DEFAULT_AUTH_PATH = '~/.claude/.credentials.json'

const UNAVAILABLE_QUOTA: ClaudeCodeQuota = {
  available: false,
  plan: '',
  fiveHourUsedPercent: null,
  fiveHourResetsAt: null,
  sevenDayUsedPercent: null,
  sevenDayResetsAt: null,
  expiresAt: null,
  hasRefreshToken: false
}

const ClaudeCodeSettings: FC = () => {
  const { t } = useTranslation()
  const [authFilePath, setAuthFilePath] = useState(() => loadPersisted(LS_AUTH_PATH, ''))
  const [refreshToken, setRefreshToken] = useState(() => loadPersistedBoolean(LS_REFRESH_TOKEN))

  useEffect(() => {
    void window.api.claudeCode.setAuthPath(authFilePath)
    void window.api.claudeCode.setSkipRefresh(!refreshToken)
  }, [authFilePath, refreshToken])

  const loadQuota = useCallback(() => {
    return window.api.claudeCode.getQuota({
      authFilePath: authFilePath || undefined,
      refreshToken
    })
  }, [authFilePath, refreshToken])

  const { loading, quota, refreshQuota } = useProviderQuota({
    providerName: 'Claude Code',
    loadQuota,
    unavailableQuota: UNAVAILABLE_QUOTA
  })

  const handleBrowse = async () => {
    const result = await selectJsonFile()
    if (result) {
      setAuthFilePath(result)
      persist(LS_AUTH_PATH, result)
    }
  }

  const handleRefreshTokenChange = (v: boolean) => {
    setRefreshToken(v)
    persist(LS_REFRESH_TOKEN, String(v))
  }

  const signedIn = quota?.available === true

  return (
    <Container>
      <Alert
        type="warning"
        showIcon
        message={t('settings.provider.claude_code.warning')}
        style={{ marginBottom: 10 }}
      />
      <Alert
        type={signedIn ? 'success' : 'info'}
        showIcon
        icon={signedIn ? <CheckCircleOutlined /> : <ExclamationCircleOutlined />}
        message={
          signedIn ? t('settings.provider.claude_code.signed_in') : t('settings.provider.claude_code.not_signed_in')
        }
        description={
          <div>
            {signedIn && quota?.plan ? (
              <DetailRow>{t('settings.provider.claude_code.plan', { plan: quota.plan })}</DetailRow>
            ) : null}
            {signedIn && quota?.expiresAt ? (
              <DetailRow>{formatExpiry(quota.expiresAt, t, 'settings.provider.claude_code.expires_at')}</DetailRow>
            ) : null}
            {signedIn && (quota?.fiveHourUsedPercent != null || quota?.sevenDayUsedPercent != null) && (
              <UsageContainer>
                {quota.fiveHourUsedPercent != null && (
                  <ProgressRow>
                    <span>
                      {t('settings.provider.claude_code.five_hour_usage', {
                        reset: formatReset(quota.fiveHourResetsAt, t)
                      })}
                    </span>
                    <StretchProgress percent={Math.round(quota.fiveHourUsedPercent)} size="small" />
                  </ProgressRow>
                )}
                {quota.sevenDayUsedPercent != null && (
                  <ProgressRow>
                    <span>
                      {t('settings.provider.claude_code.seven_day_usage', {
                        reset: formatReset(quota.sevenDayResetsAt, t)
                      })}
                    </span>
                    <StretchProgress percent={Math.round(quota.sevenDayUsedPercent)} size="small" />
                  </ProgressRow>
                )}
              </UsageContainer>
            )}
          </div>
        }
        action={
          <Button size="small" loading={loading} onClick={refreshQuota}>
            {t('settings.provider.claude_code.refresh')}
          </Button>
        }
      />
      <OptionsCard>
        <OptionRow>
          <OptionLabel>{t('settings.provider.claude_code.quota_refresh_token')}</OptionLabel>
          <Switch checked={refreshToken} onChange={handleRefreshTokenChange} />
        </OptionRow>
        <OptionRow>
          <OptionLabel>{t('settings.provider.claude_code.auth_file_path')}</OptionLabel>
          <FilePathRow>
            <FilePathInput value={authFilePath || DEFAULT_AUTH_PATH} readOnly />
            <Button onClick={handleBrowse}>{t('settings.provider.claude_code.browse')}</Button>
          </FilePathRow>
        </OptionRow>
      </OptionsCard>
    </Container>
  )
}

export default ClaudeCodeSettings
