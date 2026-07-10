import { CheckCircleOutlined, ExclamationCircleOutlined } from '@ant-design/icons'
import { Alert, Button } from 'antd'
import type { FC, ReactNode } from 'react'

interface ProviderQuotaAlertProps {
  signedIn: boolean
  loading: boolean
  message: ReactNode
  refreshLabel: string
  onRefresh: () => void
  children?: ReactNode
}

export const ProviderQuotaAlert: FC<ProviderQuotaAlertProps> = ({
  signedIn,
  loading,
  message,
  refreshLabel,
  onRefresh,
  children
}) => (
  <Alert
    type={signedIn ? 'success' : 'info'}
    showIcon
    icon={signedIn ? <CheckCircleOutlined /> : <ExclamationCircleOutlined />}
    message={message}
    description={<div>{children}</div>}
    action={
      <Button size="small" loading={loading} onClick={onRefresh}>
        {refreshLabel}
      </Button>
    }
  />
)
