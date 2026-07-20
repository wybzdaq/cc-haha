import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { shouldSkipWebFetchPreflight } from './utils.js'

describe('shouldSkipWebFetchPreflight', () => {
  const originalDesktopServerUrl = process.env.CC_HAHA_DESKTOP_SERVER_URL
  const originalDisableNonessentialTraffic =
    process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC

  beforeEach(() => {
    delete process.env.CC_HAHA_DESKTOP_SERVER_URL
    delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC
  })

  afterEach(() => {
    if (originalDesktopServerUrl === undefined) {
      delete process.env.CC_HAHA_DESKTOP_SERVER_URL
    } else {
      process.env.CC_HAHA_DESKTOP_SERVER_URL = originalDesktopServerUrl
    }

    if (originalDisableNonessentialTraffic === undefined) {
      delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC
    } else {
      process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC =
        originalDisableNonessentialTraffic
    }
  })

  test('respects explicit true from settings', () => {
    expect(
      shouldSkipWebFetchPreflight({ skipWebFetchPreflight: true }),
    ).toBe(true)
  })

  test('respects explicit false from settings even on desktop', () => {
    process.env.CC_HAHA_DESKTOP_SERVER_URL = 'http://127.0.0.1:3456'

    expect(
      shouldSkipWebFetchPreflight({ skipWebFetchPreflight: false }),
    ).toBe(false)
  })

  test('defaults to enabled for desktop sessions', () => {
    process.env.CC_HAHA_DESKTOP_SERVER_URL = 'http://127.0.0.1:3456'

    expect(shouldSkipWebFetchPreflight({})).toBe(true)
  })

  test('defaults to disabled outside desktop sessions', () => {
    expect(shouldSkipWebFetchPreflight({})).toBe(false)
  })

  test('skips Anthropic preflight when nonessential traffic is disabled', () => {
    process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'

    expect(
      shouldSkipWebFetchPreflight({ skipWebFetchPreflight: false }),
    ).toBe(true)
  })
})
