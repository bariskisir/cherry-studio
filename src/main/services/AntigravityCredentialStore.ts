import { spawn } from 'node:child_process'

const CREDENTIAL_TARGET = 'gemini:antigravity'
const KEYCHAIN_ACCOUNT = 'antigravity'
const PROCESS_TIMEOUT_MS = 10_000

interface ProcessRunner {
  run(command: string, args: string[], input?: string): Promise<string>
}

const processRunner: ProcessRunner = {
  run: (command, args, input) =>
    new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      })
      let stdout = ''
      let stderr = ''
      let settled = false

      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk
      })
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk
      })

      const finish = (error?: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        if (error) reject(error)
        else resolve(stdout.trim())
      }

      const timeout = setTimeout(() => {
        child.kill()
        finish(new Error(`${command} timed out`))
      }, PROCESS_TIMEOUT_MS)

      child.on('error', finish)
      child.on('close', (code) => {
        if (code === 0) finish()
        else finish(new Error(`${command} exited with code ${code}: ${stderr.trim()}`))
      })

      child.stdin.end(input)
    })
}

function encodePowerShell(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

function windowsReadScript(): string {
  return `
$ErrorActionPreference = 'Stop'
$sig = @"
using System;
using System.Runtime.InteropServices;
public class AntigravityCredRead {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct CREDENTIAL {
    public uint Flags; public uint Type; public IntPtr TargetName; public IntPtr Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist;
    public uint AttributeCount; public IntPtr Attributes; public IntPtr TargetAlias; public IntPtr UserName;
  }
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);
  [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr cred);
  public static string Read(string target) {
    IntPtr credPtr;
    if (!CredRead(target, 1, 0, out credPtr)) return null;
    try {
      CREDENTIAL credential = (CREDENTIAL)Marshal.PtrToStructure(credPtr, typeof(CREDENTIAL));
      byte[] blob = new byte[credential.CredentialBlobSize];
      Marshal.Copy(credential.CredentialBlob, blob, 0, (int)credential.CredentialBlobSize);
      return Convert.ToBase64String(blob);
    } finally { CredFree(credPtr); }
  }
}
"@
Add-Type -TypeDefinition $sig
$value = [AntigravityCredRead]::Read('${CREDENTIAL_TARGET}')
if ($value -eq $null) { exit 1 }
[Console]::Out.Write($value)
`
}

function windowsWriteScript(value: string): string {
  const encodedValue = Buffer.from(value, 'utf8').toString('base64')
  return `
$ErrorActionPreference = 'Stop'
$sig = @"
using System;
using System.Runtime.InteropServices;
public class AntigravityCredWrite {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct CREDENTIAL {
    public uint Flags; public uint Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist;
    public uint AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool CredWrite(ref CREDENTIAL credential, uint flags);
  public static bool Write(string target, byte[] value) {
    IntPtr blob = Marshal.AllocCoTaskMem(value.Length);
    try {
      Marshal.Copy(value, 0, blob, value.Length);
      CREDENTIAL credential = new CREDENTIAL {
        Type = 1,
        TargetName = target,
        CredentialBlobSize = (uint)value.Length,
        CredentialBlob = blob,
        Persist = 3,
        UserName = String.Empty
      };
      return CredWrite(ref credential, 0);
    } finally { Marshal.FreeCoTaskMem(blob); }
  }
}
"@
Add-Type -TypeDefinition $sig
$value = [Convert]::FromBase64String('${encodedValue}')
if (![AntigravityCredWrite]::Write('${CREDENTIAL_TARGET}', $value)) { exit 1 }
`
}

function decodeWindowsCredential(value: string): string | null {
  try {
    const blob = Buffer.from(value, 'base64')
    const decoded = blob[0] === 0xff && blob[1] === 0xfe ? blob.toString('utf16le').slice(1) : blob.toString('utf8')
    let end = decoded.length
    while (end > 0 && decoded.charCodeAt(end - 1) === 0) end -= 1
    return decoded.slice(0, end)
  } catch {
    return null
  }
}

export class AntigravityCredentialStore {
  constructor(
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly runner: ProcessRunner = processRunner
  ) {}

  public async read(): Promise<string | null> {
    try {
      switch (this.platform) {
        case 'win32': {
          const output = await this.runner.run('powershell.exe', [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-EncodedCommand',
            encodePowerShell(windowsReadScript())
          ])
          return decodeWindowsCredential(output)
        }
        case 'darwin':
          return await this.runner.run('security', [
            'find-generic-password',
            '-s',
            CREDENTIAL_TARGET,
            '-a',
            KEYCHAIN_ACCOUNT,
            '-w'
          ])
        case 'linux':
          return await this.runner.run('secret-tool', [
            'lookup',
            'application',
            'antigravity',
            'target',
            CREDENTIAL_TARGET
          ])
        default:
          return null
      }
    } catch {
      return null
    }
  }

  public async write(value: string): Promise<void> {
    switch (this.platform) {
      case 'win32':
        await this.runner.run('powershell.exe', [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-EncodedCommand',
          encodePowerShell(windowsWriteScript(value))
        ])
        return
      case 'darwin':
        await this.runner.run('security', [
          'add-generic-password',
          '-s',
          CREDENTIAL_TARGET,
          '-a',
          KEYCHAIN_ACCOUNT,
          '-w',
          value,
          '-U'
        ])
        return
      case 'linux':
        await this.runner.run(
          'secret-tool',
          ['store', `--label=${CREDENTIAL_TARGET}`, 'application', 'antigravity', 'target', CREDENTIAL_TARGET],
          value
        )
        return
      default:
        throw new Error(`Antigravity credential storage is unsupported on ${this.platform}`)
    }
  }
}
