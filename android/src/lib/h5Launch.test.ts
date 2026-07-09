import { describe, expect, it } from 'bun:test'
import { parseH5LaunchUrl } from './h5Launch'

describe('H5 launch QR parsing', () => {
  it('parses desktop H5 launch URLs', () => {
    expect(parseH5LaunchUrl(
      'http://10.10.127.107:3456/?serverUrl=http%3A%2F%2F10.10.127.107%3A3456&h5Token=h5_token_123',
    )).toEqual({
      serverUrl: 'http://10.10.127.107:3456',
      token: 'h5_token_123',
    })
  })

  it('falls back to the QR URL origin when serverUrl is omitted', () => {
    expect(parseH5LaunchUrl('http://10.10.127.107:3456/?h5Token=h5_token_123')).toEqual({
      serverUrl: 'http://10.10.127.107:3456',
      token: 'h5_token_123',
    })
  })

  it('rejects URLs without an H5 token', () => {
    expect(() => parseH5LaunchUrl('http://10.10.127.107:3456/')).toThrow('H5 token')
  })
})
