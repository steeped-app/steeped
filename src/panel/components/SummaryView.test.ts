import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SummaryView from './SummaryView'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLDivElement | null = null

afterEach(() => {
  if (root) {
    act(() => root?.unmount())
  }
  vi.restoreAllMocks()
  container?.remove()
  root = null
  container = null
})

function renderSummary() {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)

  act(() => {
    root?.render(createElement(SummaryView, {
      text: `## Note
The same source appears in the note [1].

## What Matters
- **First signal:** the first line cites the shared source [1]
- **Second signal:** the second line cites the shared source too [1]`,
      chunks: [
        { id: 1, text: 'This is the shared source preview that should only open below the clicked citation occurrence.' },
      ],
      isStreaming: false,
      pageTitle: 'A dense page',
      pageDomain: 'example.test',
    }))
  })
}

function renderDiscussionSummary(active = true) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)

  act(() => {
    root?.render(createElement(SummaryView, {
      text: `## Note
The post asks why a reef tank is cloudy, and replies split between bacterial bloom and sand disturbance [1].

## What Matters
- **OP:** the tank turned cloudy after a water change [1]
- **Split view:** replies point to bacteria, sand, and filter changes as possible causes [1]`,
      chunks: [{ id: 1, text: 'Original poster: cloudy after water change. Replies suggest bacteria, sand, and filter changes.' }],
      isStreaming: false,
      pageTitle: 'Cloudy tank thread',
      pageDomain: 'forum.example',
      discussionNoteActive: active,
      surfaceInfo: {
        kind: 'discussion-thread',
        confidence: 'high',
        label: 'Discussion',
        reason: 'forum-style URL path; repeated post blocks',
        rootPostVisible: true,
        pagePosition: 'unknown',
        rankingSignals: ['reactions'],
      },
      onRebuildAsDiscussion: active ? undefined : () => {},
      onRebuildAsRegular: active ? () => {} : undefined,
    }))
  })
}

function renderMessySourceSummary() {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)

  act(() => {
    root?.render(createElement(SummaryView, {
      text: `## Note
The thread says a Barlow is unnecessary for this telescope [1].

## What Matters
- **Skip Barlow:** A 10mm eyepiece is already high power at 235x, so delay buying a Barlow [1]`,
      chunks: [{
        id: 1,
        text: `Existing user? Sign In Sign Up
Home
Forums
Share
Followers
#1
Posted April 25, 2024
JulietAlpha14
Lift Off
Loc: Delaware, OH
A 10mm eyepiece is already high power at 235x, so skip the Barlow for now.
Buy one eyepiece at a time until your preferences become clearer.`,
      }],
      isStreaming: false,
      pageTitle: 'Figuring out Eyepieces',
      pageDomain: 'cloudynights.com',
    }))
  })
}

function clickCitation(scope: string) {
  if (!container) throw new Error('Summary has not rendered.')
  const button = container.querySelector(`button[data-cite-key^="${scope}:"]`)
  if (!button) throw new Error(`No citation button found for ${scope}.`)

  act(() => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

function expansions() {
  return container?.querySelectorAll('[data-cite-expansion="true"]') || []
}

describe('SummaryView citations', () => {
  it('opens only the clicked citation occurrence for repeated source numbers', () => {
    renderSummary()

    expect(container?.querySelectorAll('button[aria-label="Open source chunk 1"]')).toHaveLength(3)

    clickCitation('matter-0-item-0')
    expect(container?.querySelectorAll('button[aria-expanded="true"]')).toHaveLength(1)
    expect(expansions()).toHaveLength(1)
    expect(expansions()[0].getAttribute('data-cite-scope')).toBe('matter-0-item-0')

    clickCitation('matter-0-item-1')
    expect(container?.querySelectorAll('button[aria-expanded="true"]')).toHaveLength(1)
    expect(expansions()).toHaveLength(1)
    expect(expansions()[0].getAttribute('data-cite-scope')).toBe('matter-0-item-1')

    clickCitation('matter-0-item-1')
    expect(container?.querySelectorAll('button[aria-expanded="true"]')).toHaveLength(0)
    expect(expansions()).toHaveLength(0)
  })

  it('posts only a source-jump chunk id when opening a citation', () => {
    const postMessage = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {})
    renderSummary()

    clickCitation('matter-0-item-0')

    expect(postMessage).toHaveBeenCalledTimes(1)
    expect(postMessage).toHaveBeenCalledWith({ type: 'steeped:source-jump', chunkId: 1 }, '*')
    expect(JSON.stringify(postMessage.mock.calls[0])).not.toContain('shared source preview')
  })

  it('does not post another source-jump message when closing the same citation', () => {
    const postMessage = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {})
    renderSummary()

    clickCitation('matter-0-item-0')
    clickCitation('matter-0-item-0')

    expect(postMessage).toHaveBeenCalledTimes(1)
  })

  it('shows a cleaned source excerpt instead of forum chrome', () => {
    renderMessySourceSummary()

    clickCitation('matter-0-item-0')

    const expansionText = expansions()[0]?.textContent || ''
    expect(expansionText).toContain('skip the Barlow')
    expect(expansionText).not.toContain('Existing user')
    expect(expansionText).not.toContain('Followers')
    expect(expansionText).not.toContain('Loc: Delaware')
  })
})

describe('SummaryView discussion cue', () => {
  it('shows the discussion note cue and rebuild control when active', () => {
    renderDiscussionSummary(true)

    expect(container?.textContent).toContain('Discussion note')
    expect(container?.textContent).toContain('Regular note')
    expect(container?.querySelector('button[aria-label="Post and replies are summarized separately."]')).toBeTruthy()
  })

  it('keeps the discussion tooltip wrapped and anchored inside narrow panels', () => {
    renderDiscussionSummary(true)

    const tooltip = container?.querySelector('[role="tooltip"]') as HTMLElement | null
    expect(tooltip).toBeTruthy()
    expect(tooltip?.className).toContain('right-0')
    expect(tooltip?.className).toContain('whitespace-normal')
    expect(tooltip?.className).toContain('max-w-[calc(100vw-40px)]')
  })

  it('offers discussion rebuild when inactive', () => {
    renderDiscussionSummary(false)

    expect(container?.textContent).toContain('Make discussion note')
    expect(container?.textContent).not.toContain('Regular note')
  })
})
