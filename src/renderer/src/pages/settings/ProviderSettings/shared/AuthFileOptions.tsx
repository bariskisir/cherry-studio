import { Button, Switch } from 'antd'
import type { FC } from 'react'

import { FilePathInput, FilePathRow, OptionLabel, OptionRow } from './styled'

interface RefreshTokenOptionProps {
  label: string
  checked: boolean
  onChange: (enabled: boolean) => void
}

export const RefreshTokenOption: FC<RefreshTokenOptionProps> = ({ label, checked, onChange }) => (
  <OptionRow>
    <OptionLabel>{label}</OptionLabel>
    <Switch checked={checked} onChange={onChange} />
  </OptionRow>
)

interface AuthFilePathOptionProps {
  label: string
  browseLabel: string
  path: string
  defaultPath: string
  onBrowse: () => void
}

export const AuthFilePathOption: FC<AuthFilePathOptionProps> = ({
  label,
  browseLabel,
  path,
  defaultPath,
  onBrowse
}) => (
  <OptionRow>
    <OptionLabel>{label}</OptionLabel>
    <FilePathRow>
      <FilePathInput value={path || defaultPath} readOnly />
      <Button onClick={onBrowse}>{browseLabel}</Button>
    </FilePathRow>
  </OptionRow>
)
