import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { FindInPageModal } from './FindInPageModal'

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
})
