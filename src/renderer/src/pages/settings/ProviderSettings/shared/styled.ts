import { Progress } from 'antd'
import styled from 'styled-components'

export const Container = styled.div`
  padding-top: 15px;
`

export const ProgressRow = styled.div`
  display: flex;
  align-items: center;
  margin-bottom: 4px;
  font-size: 12px;
`

export const StretchProgress = styled(Progress)`
  flex: 1;
  margin-left: 8px;
`

export const OptionsCard = styled.div`
  margin-top: 12px;
  padding: 14px;
  background: var(--color-bg-2);
  border-radius: 8px;
`

export const OptionRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  &:last-child {
    margin-bottom: 0;
  }
`

export const OptionLabel = styled.span`
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  margin-right: 12px;
`

export const FilePathRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  max-width: 400px;
`

export const FilePathInput = styled.input`
  flex: 1;
  padding: 4px 8px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-bg-1);
  color: var(--color-text-1);
  font-size: 13px;
  outline: none;
`

export const DetailRow = styled.div`
  margin-bottom: 4px;
`

export const UsageContainer = styled.div`
  margin-top: 8px;
`

export const GroupSection = styled.div`
  margin-bottom: 8px;
`

export const GroupLabel = styled.div`
  font-size: 12px;
  font-weight: 500;
  margin-bottom: 2px;
`
