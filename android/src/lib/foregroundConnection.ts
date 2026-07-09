export type MobileAppState = 'active' | 'background' | 'inactive' | 'unknown' | 'extension'
export type ForegroundConnectionStatus = 'checking' | 'connected' | 'failed'

type ForegroundConnectionDeps = {
  initBaseUrl: () => Promise<unknown>
  testConnection: () => Promise<boolean>
  fetchSessions: () => Promise<unknown>
}

export function shouldConnectForAppState(
  previousState: MobileAppState | null,
  nextState: MobileAppState,
) {
  return nextState === 'active' && previousState !== 'active'
}

export async function runForegroundConnection({
  initBaseUrl,
  testConnection,
  fetchSessions,
}: ForegroundConnectionDeps): Promise<{ status: ForegroundConnectionStatus; message: string }> {
  await initBaseUrl()

  const connected = await testConnection()
  if (!connected) {
    return {
      status: 'failed',
      message: 'Windows desktop is not reachable',
    }
  }

  await fetchSessions()
  return {
    status: 'connected',
    message: 'Connected to Windows desktop',
  }
}
