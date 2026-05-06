import { describe, expect, it } from 'vitest'
import {
  canOfferDiscussionNote,
  getDiscussionNoteHelp,
  getDiscussionNotePreference,
  shouldUseDiscussionNote,
} from './discussion'
import type { SurfaceInfo } from './types'

const mediumDiscussion: SurfaceInfo = {
  kind: 'discussion-thread',
  confidence: 'medium',
  label: 'Discussion',
  reason: 'forum-style URL path',
  rootPostVisible: 'unknown',
  pagePosition: 'unknown',
  rankingSignals: [],
}

const highDiscussion: SurfaceInfo = {
  ...mediumDiscussion,
  confidence: 'high',
}

const pdfDocument: SurfaceInfo = {
  kind: 'article',
  confidence: 'medium',
  label: 'PDF document',
  reason: 'PDF text extracted directly',
  rootPostVisible: 'unknown',
  pagePosition: 'unknown',
  rankingSignals: [],
}

describe('discussion note preference', () => {
  it('defaults unknown values to auto', () => {
    expect(getDiscussionNotePreference('loud')).toBe('auto')
  })

  it('uses high-confidence discussion pages in auto mode', () => {
    expect(shouldUseDiscussionNote(highDiscussion, 'auto')).toBe(true)
  })

  it('requires more-often for medium-confidence discussion pages', () => {
    expect(shouldUseDiscussionNote(mediumDiscussion, 'auto')).toBe(false)
    expect(shouldUseDiscussionNote(mediumDiscussion, 'more-often')).toBe(true)
  })

  it('honors manual override and off settings', () => {
    expect(shouldUseDiscussionNote(highDiscussion, 'off')).toBe(false)
    expect(shouldUseDiscussionNote(undefined, 'off', 'discussion')).toBe(true)
    expect(shouldUseDiscussionNote(highDiscussion, 'auto', 'regular')).toBe(false)
  })

  it('offers manual discussion rebuild only for detected discussion-like surfaces', () => {
    expect(canOfferDiscussionNote(highDiscussion)).toBe(true)
    expect(canOfferDiscussionNote(mediumDiscussion)).toBe(true)
    expect(canOfferDiscussionNote(pdfDocument)).toBe(false)
    expect(canOfferDiscussionNote(undefined)).toBe(false)
  })

  it('explains later-page thread context', () => {
    expect(getDiscussionNoteHelp({
      ...highDiscussion,
      rootPostVisible: false,
      pagePosition: 'later-page',
    })).toContain('Root post may not be on this page')
  })
})
