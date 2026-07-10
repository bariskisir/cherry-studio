import fs from 'node:fs'
import path from 'node:path'

import { writeWithLock } from '@main/utils/file'

export async function readJsonFile<T = unknown>(filePath: string): Promise<T> {
  const text = await fs.promises.readFile(filePath, 'utf-8')
  return JSON.parse(text.replace(/^\uFEFF/, '')) as T
}

export async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
  await writeWithLock(filePath, JSON.stringify(data, null, 2), {
    atomic: true,
    encoding: 'utf-8',
    mode: 0o600
  })
}
