import { CheckCircleOutlined, ExclamationCircleOutlined } from '@ant-design/icons'
import type { AntigravityAuthOptions, AntigravityBucket, AntigravityQuota } from '@shared/cliProvider'
import { Alert, Button, Select, Switch } from 'antd'
import { type FC, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Container,
  DetailRow,
  FilePathInput,
  FilePathRow,
  GroupLabel,
  GroupSection,
  OptionLabel,
  OptionRow,
  OptionsCard,
  ProgressRow,
  StretchProgress,
  UsageContainer
} from './shared/styled'
import { useProviderQuota } from './shared/useProviderQuota'
import { formatExpiry, formatReset, loadPersisted, loadPersistedBoolean, persist, selectJsonFile } from './shared/utils'

const LS_AUTH_SOURCE = 'antigravity-auth-source'
const LS_AUTH_PATH = 'antigravity-auth-path'
const LS_REFRESH_TOKEN = 'antigravity-refresh-token'
const DEFAULT_AUTH_PATH = '~/.antigravity/.credentials.json'

type AuthSource = 'windows_credentials' | 'auth_file'

const UNAVAILABLE_QUOTA: AntigravityQuota = {
  available: false,
  email: '',
  plan: '',
  projectId: '',
  groups: [],
  expiresAt: null,
  hasRefreshToken: false
}

function parseWindowHours(window: string): number {
  const match = window.match(/^(\d+)([hd])$/i)
  if (!match) return Number.POSITIVE_INFINITY
  const value = Number.parseInt(match[1], 10)
  return match[2].toLowerCase() === 'd' ? value * 24 : value
}

const AntigravitySettings: FC = () => {
  const { t } = useTranslation()
  const [authSource, setAuthSource] = useState<AuthSource>(() => {
    const v = loadPersisted(LS_AUTH_SOURCE, 'windows_credentials')
    return v === 'auth_file' ? 'auth_file' : 'windows_credentials'
  })
  const [authFilePath, setAuthFilePath] = useState(() => loadPersisted(LS_AUTH_PATH, ''))
  const [refreshToken, setRefreshToken] = useState(() => loadPersistedBoolean(LS_REFRESH_TOKEN))

  useEffect(() => {
    void window.api.antigravity.setAuthPath(authSource === 'auth_file' ? authFilePath : '')
    void window.api.antigravity.setAuthSource(authSource === 'windows_credentials')
    void window.api.antigravity.setSkipRefresh(!refreshToken)
  }, [authFilePath, authSource, refreshToken])

  const loadQuota = useCallback(() => {
    const options: AntigravityAuthOptions = {
      authFilePath: authSource === 'auth_file' ? authFilePath || undefined : undefined,
      useCredentialManager: authSource === 'windows_credentials',
      refreshToken
    }
    return window.api.antigravity.getQuota(options)
  }, [authFilePath, authSource, refreshToken])

  const { loading, quota, refreshQuota } = useProviderQuota({
    providerName: 'Antigravity',
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

  const handleAuthSourceChange = (v: AuthSource) => {
    setAuthSource(v)
    persist(LS_AUTH_SOURCE, v)
  }

  const signedIn = quota?.available === true

  const bucketLabel = (bucket: AntigravityBucket, siblings: AntigravityBucket[]): string => {
    if (siblings.length <= 1) return t('settings.provider.antigravity.session')
    const sorted = [...siblings].sort((a, b) => parseWindowHours(a.window) - parseWindowHours(b.window))
    if (bucket === sorted[0]) return t('settings.provider.antigravity.session')
    return bucket.window
  }

  return (
    <Container>
      <Alert
        type="warning"
        showIcon
        message={t('settings.provider.antigravity.warning')}
        style={{ marginBottom: 10 }}
      />
      <Alert
        type={signedIn ? 'success' : 'info'}
        showIcon
        icon={signedIn ? <CheckCircleOutlined /> : <ExclamationCircleOutlined />}
        message={
          signedIn
            ? t('settings.provider.antigravity.signed_in', { email: quota?.email || quota?.projectId || '' })
            : t('settings.provider.antigravity.not_signed_in')
        }
        description={
          <div>
            {signedIn && quota?.plan ? (
              <DetailRow>{t('settings.provider.antigravity.plan', { plan: quota.plan })}</DetailRow>
            ) : null}
            {signedIn && quota?.projectId ? (
              <DetailRow>{t('settings.provider.antigravity.project', { project: quota.projectId })}</DetailRow>
            ) : null}
            {signedIn && quota?.expiresAt ? (
              <DetailRow>{formatExpiry(quota.expiresAt, t, 'settings.provider.antigravity.expires_at')}</DetailRow>
            ) : null}
            {signedIn && quota?.groups && quota.groups.length > 0 && (
              <UsageContainer>
                {quota.groups.map((group) => (
                  <GroupSection key={group.displayName}>
                    <GroupLabel>{group.displayName}</GroupLabel>
                    {group.buckets.map((bucket) => (
                      <ProgressRow key={bucket.window}>
                        <span>
                          {bucketLabel(bucket, group.buckets)}
                          {bucket.resetTime
                            ? ` (${t('settings.provider.antigravity.resets_in', { time: formatReset(bucket.resetTime, t) })})`
                            : ''}
                        </span>
                        <StretchProgress percent={Math.round(bucket.usedPercent)} size="small" />
                      </ProgressRow>
                    ))}
                  </GroupSection>
                ))}
              </UsageContainer>
            )}
          </div>
        }
        action={
          <Button size="small" loading={loading} onClick={refreshQuota}>
            {t('settings.provider.antigravity.refresh')}
          </Button>
        }
      />
      <OptionsCard>
        <OptionRow>
          <OptionLabel>{t('settings.provider.antigravity.quota_refresh_token')}</OptionLabel>
          <Switch checked={refreshToken} onChange={handleRefreshTokenChange} />
        </OptionRow>
        <OptionRow>
          <OptionLabel>{t('settings.provider.antigravity.auth_source')}</OptionLabel>
          <Select
            value={authSource}
            onChange={handleAuthSourceChange}
            style={{ width: 200 }}
            options={[
              { value: 'windows_credentials', label: t('settings.provider.antigravity.auth_source_windows') },
              { value: 'auth_file', label: t('settings.provider.antigravity.auth_source_file') }
            ]}
          />
        </OptionRow>
        {authSource === 'auth_file' && (
          <OptionRow>
            <OptionLabel>{t('settings.provider.antigravity.auth_file_path')}</OptionLabel>
            <FilePathRow>
              <FilePathInput value={authFilePath || DEFAULT_AUTH_PATH} readOnly />
              <Button onClick={handleBrowse}>{t('settings.provider.antigravity.browse')}</Button>
            </FilePathRow>
          </OptionRow>
        )}
      </OptionsCard>
    </Container>
  )
}

export default AntigravitySettings
