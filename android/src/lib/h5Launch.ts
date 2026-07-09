export type H5LaunchConfig = {
  serverUrl: string
  token: string
}

export function parseH5LaunchUrl(rawValue: string): H5LaunchConfig {
  const value = rawValue.trim()
  if (!value) {
    throw new Error('QR code is empty.')
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('QR code is not a valid H5 access URL.')
  }

  const token = url.searchParams.get('h5Token') || url.searchParams.get('token') || ''
  if (!token.trim()) {
    throw new Error('QR code does not include an H5 token.')
  }

  const serverUrlParam = url.searchParams.get('serverUrl')
  const serverUrl = normalizeServerUrl(serverUrlParam || `${url.protocol}//${url.host}${url.pathname}`)

  return {
    serverUrl,
    token: token.trim(),
  }
}

function normalizeServerUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error('QR code server URL is invalid.')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('QR code server URL must use http or https.')
  }

  url.search = ''
  url.hash = ''
  const normalized = url.toString().replace(/\/$/, '')
  if (!normalized) {
    throw new Error('QR code server URL is invalid.')
  }
  return normalized
}
