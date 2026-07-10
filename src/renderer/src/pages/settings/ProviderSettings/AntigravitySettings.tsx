import type { AntigravityBucket, AntigravityQuota } from '@shared/cliProvider'
import { Alert } from 'antd'
import { type FC, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { RefreshTokenOption } from './shared/AuthFileOptions'
import { ProviderQuotaAlert } from './shared/ProviderQuotaAlert'
import {
  Container,
  DetailRow,
  GroupLabel,
  GroupSection,
  OptionsCard,
  ProgressRow,
  StretchProgress,
  UsageContainer
} from './shared/styled'
import { usePersistedBooleanSetting } from './shared/useAuthFileSettings'
import { useProviderQuota } from './shared/useProviderQuota'
import { formatExpiry, formatReset } from './shared/utils'

const LS_REFRESH_TOKEN = 'antigravity-refresh-token'

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
  const { value: refreshToken, updateValue: updateRefreshToken } = usePersistedBooleanSetting(LS_REFRESH_TOKEN)

  useEffect(() => {
    void window.api.antigravity.setSkipRefresh(!refreshToken)
  }, [refreshToken])

  const loadQuota = useCallback(() => {
    return window.api.antigravity.getQuota({ refreshToken })
  }, [refreshToken])

  const { loading, quota, refreshQuota } = useProviderQuota({
    providerName: 'Antigravity',
    loadQuota,
    unavailableQuota: UNAVAILABLE_QUOTA
  })

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
      <ProviderQuotaAlert
        signedIn={signedIn}
        loading={loading}
        message={
          signedIn
            ? t('settings.provider.antigravity.signed_in', { email: quota?.email || quota?.projectId || '' })
            : t('settings.provider.antigravity.not_signed_in')
        }
        refreshLabel={t('settings.provider.antigravity.refresh')}
        onRefresh={refreshQuota}>
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
      </ProviderQuotaAlert>
      <OptionsCard>
        <RefreshTokenOption
          label={t('settings.provider.antigravity.quota_refresh_token')}
          checked={refreshToken}
          onChange={updateRefreshToken}
        />
      </OptionsCard>
    </Container>
  )
}

export default AntigravitySettings
