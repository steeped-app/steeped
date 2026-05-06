import type { SurfaceInfo } from './types'

export type DiscussionNotePreference = 'auto' | 'more-often' | 'off'
export type DiscussionNoteOverride = 'auto' | 'discussion' | 'regular'

export const DISCUSSION_NOTE_PREFERENCE_KEY = 'discussionNotePreference'
export const DEFAULT_DISCUSSION_NOTE_PREFERENCE: DiscussionNotePreference = 'auto'

export function getDiscussionNotePreference(value: unknown): DiscussionNotePreference {
  if (value === 'more-often' || value === 'off' || value === 'auto') return value
  return DEFAULT_DISCUSSION_NOTE_PREFERENCE
}

export function shouldUseDiscussionNote(
  surfaceInfo: SurfaceInfo | undefined,
  preference: DiscussionNotePreference = DEFAULT_DISCUSSION_NOTE_PREFERENCE,
  override: DiscussionNoteOverride = 'auto',
): boolean {
  if (override === 'discussion') return true
  if (override === 'regular') return false
  if (preference === 'off') return false
  if (!surfaceInfo) return false
  if (surfaceInfo.kind === 'unknown' || surfaceInfo.kind === 'article') return false
  if (surfaceInfo.confidence === 'high') return true
  return preference === 'more-often' && surfaceInfo.confidence === 'medium'
}

export function canOfferDiscussionNote(surfaceInfo: SurfaceInfo | undefined): boolean {
  if (!surfaceInfo) return false
  if (surfaceInfo.kind === 'unknown' || surfaceInfo.kind === 'article') return false
  return surfaceInfo.confidence === 'high' || surfaceInfo.confidence === 'medium'
}

export function getDiscussionNoteLabel(surfaceInfo: SurfaceInfo | undefined): string {
  if (!surfaceInfo) return 'Discussion note'
  if (surfaceInfo.kind === 'issue-thread') return 'Issue thread'
  if (surfaceInfo.kind === 'qa-thread') return 'Q&A thread'
  return 'Discussion note'
}

export function getDiscussionNoteHelp(surfaceInfo: SurfaceInfo | undefined): string {
  if (surfaceInfo?.rootPostVisible === false || surfaceInfo?.pagePosition === 'later-page') {
    return 'Visible replies summarized. Root post may not be on this page.'
  }
  if (surfaceInfo?.kind === 'qa-thread') {
    return 'Question and answers are summarized separately.'
  }
  if (surfaceInfo?.kind === 'issue-thread') {
    return 'Issue and replies are summarized separately.'
  }
  return 'Post and replies are summarized separately.'
}
