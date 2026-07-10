import type { ClaudeCodeQuota } from '@shared/cliProvider'
import { Alert } from 'antd'
import { type FC, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { AuthFilePathOption, RefreshTokenOption } from './shared/AuthFileOptions'
import { ProviderQuotaAlert } from './shared/ProviderQuotaAlert'
import { Container, DetailRow, OptionsCard, ProgressRow, StretchProgress, UsageContainer } from './shared/styled'
import { useAuthFileSettings } from './shared/useAuthFileSettings'
import { useProviderQuota } from './shared/useProviderQuota'
import { formatExpiry, formatReset } from './shared/utils'

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
  const { authFilePath, refreshToken, browseAuthFile, updateRefreshToken } = useAuthFileSettings({
    authPathStorageKey: LS_AUTH_PATH,
    refreshTokenStorageKey: LS_REFRESH_TOKEN
  })

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

  const signedIn = quota?.available === true

  return (
    <Container>
      <Alert
        type="warning"
        showIcon
        message={t('settings.provider.claude_code.warning')}
        style={{ marginBottom: 10 }}
      />
      <ProviderQuotaAlert
        signedIn={signedIn}
        loading={loading}
        message={
          signedIn ? t('settings.provider.claude_code.signed_in') : t('settings.provider.claude_code.not_signed_in')
        }
        refreshLabel={t('settings.provider.claude_code.refresh')}
        onRefresh={refreshQuota}>
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
      </ProviderQuotaAlert>
      <OptionsCard>
        <RefreshTokenOption
          label={t('settings.provider.claude_code.quota_refresh_token')}
          checked={refreshToken}
          onChange={updateRefreshToken}
        />
        <AuthFilePathOption
          label={t('settings.provider.claude_code.auth_file_path')}
          browseLabel={t('settings.provider.claude_code.browse')}
          path={authFilePath}
          defaultPath={DEFAULT_AUTH_PATH}
          onBrowse={browseAuthFile}
        />
      </OptionsCard>
    </Container>
  )
}

export default ClaudeCodeSettings
