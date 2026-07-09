import { describe, expect, it } from 'bun:test'
import { shouldConnectForAppState, runForegroundConnection } from './foregroundConnection'

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
})
