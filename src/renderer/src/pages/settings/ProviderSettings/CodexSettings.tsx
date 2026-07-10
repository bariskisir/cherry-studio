import { CheckCircleOutlined, ExclamationCircleOutlined } from '@ant-design/icons'
import type { CodexQuota } from '@shared/cliProvider'
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
  const [authFilePath, setAuthFilePath] = useState(() => loadPersisted(LS_AUTH_PATH, ''))
  const [refreshToken, setRefreshToken] = useState(() => loadPersistedBoolean(LS_REFRESH_TOKEN))

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
        type={signedIn ? 'success' : 'info'}
        showIcon
        icon={signedIn ? <CheckCircleOutlined /> : <ExclamationCircleOutlined />}
        message={
          signedIn
            ? t('settings.provider.codex.signed_in', { email: quota?.email || '' })
            : t('settings.provider.codex.not_signed_in')
        }
        description={
          <div>
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
                    <span>
                      {t('settings.provider.codex.weekly_usage', { reset: formatReset(quota.weeklyResetAt, t) })}
                    </span>
                    <StretchProgress percent={Math.round(quota.weeklyUsedPercent)} size="small" />
                  </ProgressRow>
                )}
              </UsageContainer>
            )}
          </div>
        }
        action={
          <Button size="small" loading={loading} onClick={refreshQuota}>
            {t('settings.provider.codex.refresh')}
          </Button>
        }
      />
      <OptionsCard>
        <OptionRow>
          <OptionLabel>{t('settings.provider.codex.quota_refresh_token')}</OptionLabel>
          <Switch checked={refreshToken} onChange={handleRefreshTokenChange} />
        </OptionRow>
        <OptionRow>
          <OptionLabel>{t('settings.provider.codex.auth_file_path')}</OptionLabel>
          <FilePathRow>
            <FilePathInput value={authFilePath || DEFAULT_AUTH_PATH} readOnly />
            <Button onClick={handleBrowse}>{t('settings.provider.codex.browse')}</Button>
          </FilePathRow>
        </OptionRow>
      </OptionsCard>
    </Container>
  )
}

export default CodexSettings
