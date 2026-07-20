import { afterEach, describe, expect, mock, test } from 'bun:test'
import {
  _resetPreconnectAnthropicApiForTests,
  preconnectAnthropicApi,
} from './apiPreconnect.js'

const ORIGINAL_FETCH = globalThis.fetch

describe('preconnectAnthropicApi', () => {
  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH
    delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC
    delete process.env.ANTHROPIC_BASE_URL
    _resetPreconnectAnthropicApiForTests()
  })

  test('does not preconnect when nonessential traffic is disabled', () => {
    process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
    const fetchMock = mock(() => Promise.resolve(new Response(null)))
    globalThis.fetch = fetchMock as typeof fetch

    preconnectAnthropicApi()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('preconnects to the configured API base when unrestricted', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://api.example.test/anthropic'
    const fetchMock = mock(() => Promise.resolve(new Response(null)))
    globalThis.fetch = fetchMock as typeof fetch

    preconnectAnthropicApi()

    expect(fetchMock).toHaveBeenCalledWith('https://api.example.test/anthropic', {
      method: 'HEAD',
      signal: expect.any(AbortSignal),
    })
  })
})
