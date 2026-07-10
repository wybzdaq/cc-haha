export type MobileAppState = 'active' | 'background' | 'inactive' | 'unknown' | 'extension'
export type ForegroundConnectionStatus = 'checking' | 'connected' | 'failed'
export type ConnectionFailureReason = 'timeout' | 'unauthorized' | 'network' | 'server-error' | 'unknown'
export type ConnectionCheckResult =
  | { ok: true }
  | { ok: false; reason: ConnectionFailureReason; message?: string }

type ForegroundConnectionDeps = {
  initBaseUrl: () => Promise<unknown>
  testConnection: () => Promise<boolean | ConnectionCheckResult>
  fetchSessions: () => Promise<unknown>
}

type RecentProjectLike = {
  projectPath: string
  modifiedAt?: string
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

  const result = await testConnection()
  const connected = typeof result === 'boolean' ? result : result.ok
  if (!connected) {
    return {
      status: 'failed',
      message: typeof result === 'boolean'
        ? 'Windows desktop is not reachable'
        : describeConnectionFailure(result),
    }
  }

  await fetchSessions()
  return {
    status: 'connected',
    message: 'Connected to Windows desktop',
  }
}

export function describeConnectionFailure(result: ConnectionCheckResult) {
  if (result.ok === true) return 'Connected to Windows desktop'

  switch (result.reason) {
    case 'timeout':
      return 'Connection timed out. Check the Windows IP, Wi-Fi, and firewall for port 3456.'
    case 'unauthorized':
      return 'Token was rejected. Scan the Windows H5 QR code again or update the access token.'
    case 'network':
      return 'Windows desktop is unreachable. Make sure the service is running and both devices are on the same LAN.'
    case 'server-error':
      return 'Windows desktop responded with an error. Restart the desktop app and try again.'
    default:
      return result.message || 'Windows desktop is not reachable.'
  }
}

export function chooseDefaultWorkDir({
  selectedProjectPath,
  recentProjects,
  fallbackWorkDir,
}: {
  selectedProjectPath?: string | null
  recentProjects: RecentProjectLike[]
  fallbackWorkDir: string
}) {
  const selected = selectedProjectPath?.trim()
  if (selected && selected !== 'Unknown project') {
    return selected
  }

  const [latestProject] = [...recentProjects].sort((a, b) => (
    safeTime(b.modifiedAt) - safeTime(a.modifiedAt)
  ))
  return latestProject?.projectPath || fallbackWorkDir
}

function safeTime(value?: string) {
  const time = Date.parse(value || '')
  return Number.isNaN(time) ? 0 : time
}
