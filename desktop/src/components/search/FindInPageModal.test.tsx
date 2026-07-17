import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { FindInPageModal } from './FindInPageModal'
import { registerConversationFindController } from './conversationFindBridge'

describe('FindInPageModal', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps DOM-scoped search for non-chat pages', async () => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    })
    const highlights = new Map<string, { ranges: Range[]; priority?: number }>()
    class TestHighlight {
      ranges: Range[] = []
      priority?: number

      add(range: Range) {
        this.ranges.push(range)
      }
    }
    vi.stubGlobal('CSS', { highlights })
    vi.stubGlobal('Highlight', TestHighlight)

    render(
      <>
        <main>Settings page searchable value</main>
        <FindInPageModal open onClose={() => {}} />
      </>,
    )

    fireEvent.change(screen.getByPlaceholderText('Find'), { target: { value: 'searchable' } })

    await waitFor(() => expect(screen.getByText('1 / 1')).toBeTruthy())
    expect(highlights.get('cc-find-active')?.ranges).toHaveLength(1)
    expect(highlights.get('cc-find-active')?.ranges[0]?.startContainer.parentElement?.tagName).toBe('MAIN')
  })

  it('prefers visible non-chat content while a conversation controller is mounted', async () => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    })
    const highlights = new Map<string, { ranges: Range[]; priority?: number }>()
    class TestHighlight {
      ranges: Range[] = []

      add(range: Range) {
        this.ranges.push(range)
      }
    }
    vi.stubGlobal('CSS', { highlights })
    vi.stubGlobal('Highlight', TestHighlight)
    const search = vi.fn(() => 3)
    const unregister = registerConversationFindController({ search, navigate: vi.fn(), clear: vi.fn() })

    try {
      render(
        <>
          <main>Workspace panel unique value</main>
          <div className="chat-scroll-area">Chat content</div>
          <FindInPageModal open onClose={() => {}} />
        </>,
      )

      fireEvent.change(screen.getByPlaceholderText('Find'), { target: { value: 'unique value' } })

      await waitFor(() => expect(screen.getByText('1 / 1')).toBeTruthy())
      expect(search).not.toHaveBeenCalled()
      expect(highlights.get('cc-find-active')?.ranges[0]?.startContainer.parentElement?.tagName).toBe('MAIN')
    } finally {
      act(() => unregister())
    }
  })

  it('reruns an open query when the active conversation changes', async () => {
    vi.stubGlobal('CSS', { highlights: new Map() })
    const firstSearch = vi.fn(() => 2)
    const unregisterFirst = registerConversationFindController({
      search: firstSearch,
      navigate: vi.fn(),
      clear: vi.fn(),
    })
    render(<FindInPageModal open onClose={() => {}} />)

    fireEvent.change(screen.getByPlaceholderText('Find'), { target: { value: 'session needle' } })
    await waitFor(() => expect(firstSearch).toHaveBeenCalledWith('session needle'))
    await waitFor(() => expect(screen.getByText('1 / 2')).toBeTruthy())

    const secondSearch = vi.fn(() => 4)
    const unregisterSecond = await act(async () => {
      unregisterFirst()
      return registerConversationFindController({
        search: secondSearch,
        navigate: vi.fn(),
        clear: vi.fn(),
      })
    })

    try {
      await waitFor(() => expect(secondSearch).toHaveBeenCalledWith('session needle'))
      await waitFor(() => expect(screen.getByText('1 / 4')).toBeTruthy())
    } finally {
      act(() => unregisterSecond())
    }
  })
})
