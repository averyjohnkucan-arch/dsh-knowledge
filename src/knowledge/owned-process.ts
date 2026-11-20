import { execFile, type ChildProcess } from 'node:child_process'
/** Only use for child processes created with a private process group. */
export function stopOwnedProcess(child: ChildProcess, signal: NodeJS.Signals = 'SIGKILL'): void {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32') {
    execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {})
    return
  }
  try { process.kill(-child.pid, signal) } catch { child.kill(signal) }
}
