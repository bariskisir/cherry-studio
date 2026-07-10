import type { CodexQuota } from '@shared/cliProvider'
import { type FC, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { AuthFilePathOption, RefreshTokenOption } from './shared/AuthFileOptions'
import { ProviderQuotaAlert } from './shared/ProviderQuotaAlert'
import { Container, DetailRow, OptionsCard, ProgressRow, StretchProgress, UsageContainer } from './shared/styled'
import { useAuthFileSettings } from './shared/useAuthFileSettings'
import { useProviderQuota } from './shared/useProviderQuota'
import { formatExpiry, formatReset } from './shared/utils'

const LS_AUTH_PATH = 'codex-auth-path'
const LS_REFRESH_TOKEN = 'codex-refresh-token'
const DEFAULT_AUTH_PATH = '~/.codex/auth.json'

const UNAVAILABLE_QUOTA: CodexQuota = {
  available: false,
  email: '',
  plan: '',
  sessionUsedPercent: null,
  sessionResetAt: null,
  weeklyUsedPercent: null,
  weeklyResetAt: null,
  expiresAt: null,
  hasRefreshToken: false
}

const CodexSettings: FC = () => {
  const { t } = useTranslation()
  const { authFilePath, refreshToken, browseAuthFile, updateRefreshToken } = useAuthFileSettings({
    authPathStorageKey: LS_AUTH_PATH,
    refreshTokenStorageKey: LS_REFRESH_TOKEN
  })

  useEffect(() => {
    void window.api.codex.setAuthPath(authFilePath)
    void window.api.codex.setSkipRefresh(!refreshToken)
  }, [authFilePath, refreshToken])

  const loadQuota = useCallback(() => {
    return window.api.codex.getQuota({
      authFilePath: authFilePath || undefined,
      refreshToken
    })
  }, [authFilePath, refreshToken])

  const { loading, quota, refreshQuota } = useProviderQuota({
    providerName: 'Codex',
    loadQuota,
    unavailableQuota: UNAVAILABLE_QUOTA
  })

  const signedIn = quota?.available === true

  return (
    <Container>
      <ProviderQuotaAlert
        signedIn={signedIn}
        loading={loading}
        message={
          signedIn
            ? t('settings.provider.codex.signed_in', { email: quota?.email || '' })
            : t('settings.provider.codex.not_signed_in')
        }
        refreshLabel={t('settings.provider.codex.refresh')}
        onRefresh={refreshQuota}>
        {signedIn && quota?.plan ? (
          <DetailRow>{t('settings.provider.codex.plan', { plan: quota.plan })}</DetailRow>
        ) : null}
        {signedIn && quota?.expiresAt ? (
          <DetailRow>{formatExpiry(quota.expiresAt, t, 'settings.provider.codex.expires_at')}</DetailRow>
        ) : null}
        {signedIn && (quota?.sessionUsedPercent != null || quota?.weeklyUsedPercent != null) && (
          <UsageContainer>
            {quota.sessionUsedPercent != null && (
              <ProgressRow>
                <span>
                  {t('settings.provider.codex.session_usage', { reset: formatReset(quota.sessionResetAt, t) })}
                </span>
                <StretchProgress percent={Math.round(quota.sessionUsedPercent)} size="small" />
              </ProgressRow>
            )}
            {quota.weeklyUsedPercent != null && (
              <ProgressRow>
                <span>{t('settings.provider.codex.weekly_usage', { reset: formatReset(quota.weeklyResetAt, t) })}</span>
                <StretchProgress percent={Math.round(quota.weeklyUsedPercent)} size="small" />
              </ProgressRow>
            )}
          </UsageContainer>
        )}
      </ProviderQuotaAlert>
      <OptionsCard>
        <RefreshTokenOption
          label={t('settings.provider.codex.quota_refresh_token')}
          checked={refreshToken}
          onChange={updateRefreshToken}
        />
        <AuthFilePathOption
          label={t('settings.provider.codex.auth_file_path')}
          browseLabel={t('settings.provider.codex.browse')}
          path={authFilePath}
          defaultPath={DEFAULT_AUTH_PATH}
          onBrowse={browseAuthFile}
        />
      </OptionsCard>
    </Container>
  )
}

export default CodexSettings
