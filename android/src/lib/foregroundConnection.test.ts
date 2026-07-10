import { describe, expect, it } from 'bun:test'
import {
  chooseDefaultWorkDir,
  describeConnectionFailure,
  shouldConnectForAppState,
  runForegroundConnection,
} from './foregroundConnection'

describe('foreground desktop connection', () => {
  it('connects on initial active state and when returning from background', () => {
    expect(shouldConnectForAppState(null, 'active')).toBe(true)
    expect(shouldConnectForAppState('background', 'active')).toBe(true)
    expect(shouldConnectForAppState('inactive', 'active')).toBe(true)
  })

  it('does not reconnect when the app remains active', () => {
    expect(shouldConnectForAppState('active', 'active')).toBe(false)
    expect(shouldConnectForAppState('active', 'background')).toBe(false)
  })

  it('refreshes sessions after a successful connection', async () => {
    const calls: string[] = []

    const result = await runForegroundConnection({
      initBaseUrl: async () => calls.push('init'),
      testConnection: async () => {
        calls.push('test')
        return true
      },
      fetchSessions: async () => calls.push('fetch'),
    })

    expect(result).toEqual({ status: 'connected', message: 'Connected to Windows desktop' })
    expect(calls).toEqual(['init', 'test', 'fetch'])
  })

  it('does not refresh sessions after a failed connection', async () => {
    const calls: string[] = []

    const result = await runForegroundConnection({
      initBaseUrl: async () => calls.push('init'),
      testConnection: async () => {
        calls.push('test')
        return false
      },
      fetchSessions: async () => calls.push('fetch'),
    })

    expect(result.status).toBe('failed')
    expect(calls).toEqual(['init', 'test'])
  })

  it('describes common connection failures with next steps', () => {
    expect(describeConnectionFailure({ ok: false, reason: 'timeout' })).toContain('timed out')
    expect(describeConnectionFailure({ ok: false, reason: 'unauthorized' })).toContain('Token')
    expect(describeConnectionFailure({ ok: false, reason: 'network' })).toContain('service is running')
    expect(describeConnectionFailure({ ok: false, reason: 'server-error' })).toContain('Windows desktop responded')
  })

  it('uses the newest Windows recent project as the default workdir', () => {
    expect(chooseDefaultWorkDir({
      selectedProjectPath: '',
      recentProjects: [
        { projectPath: 'D:\\Code\\Recent', modifiedAt: '2026-07-09T10:00:00.000Z', sessionCount: 1 },
      ],
      fallbackWorkDir: 'D:\\Code\\Fallback',
    })).toBe('D:\\Code\\Recent')
  })

  it('keeps the selected project path ahead of recent projects', () => {
    expect(chooseDefaultWorkDir({
      selectedProjectPath: 'D:\\Code\\Selected',
      recentProjects: [
        { projectPath: 'D:\\Code\\Recent', modifiedAt: '2026-07-09T10:00:00.000Z', sessionCount: 1 },
      ],
      fallbackWorkDir: 'D:\\Code\\Fallback',
    })).toBe('D:\\Code\\Selected')
  })
})
