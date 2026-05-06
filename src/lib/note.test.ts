import { describe, expect, it } from 'vitest'
import { parseSteepedNote } from './note'

describe('parseSteepedNote', () => {
  it('parses the short-note format', () => {
    const parsed = parseSteepedNote(`## Note
The pilot cut review time by 31% while keeping source checks attached [1]. Editors still flagged rollout risk around ambiguous ownership [2].

## What Matters

### Results
- **Review time:** The team reported a 31% reduction after the new source trail shipped [1]
- **Rollout risk:** Ownership questions remain unresolved before wider deployment [2]`)

    expect(parsed.note).toContain('31%')
    expect(parsed.groups).toHaveLength(1)
    expect(parsed.groups[0].heading).toBe('Results')
    expect(parsed.groups[0].items[0]).toContain('Review time')
  })

  it('parses flat What Matters bullets', () => {
    const parsed = parseSteepedNote(`## Note
The page becomes a compact note with source citations attached [1].

## What Matters
- **First signal:** The parser keeps flat bullets in a single unnamed group [1]
- **Second signal:** The side panel can render the list without topical subheads [2]`)

    expect(parsed.note).toContain('compact note')
    expect(parsed.groups).toHaveLength(1)
    expect(parsed.groups[0].heading).toBe('')
    expect(parsed.groups[0].items).toHaveLength(2)
  })

  it('parses one-section notes with inline bullets', () => {
    const parsed = parseSteepedNote(`## Note
The page becomes a compact note with source citations attached [1].

- **First signal:** The parser keeps inline bullets in a single unnamed group [1]
- **Second signal:** The side panel can still render the list below the note [2]`)

    expect(parsed.note).toBe('The page becomes a compact note with source citations attached [1].')
    expect(parsed.groups).toHaveLength(1)
    expect(parsed.groups[0].items).toHaveLength(2)
  })

  it('parses legacy TL;DR output for saved history', () => {
    const parsed = parseSteepedNote(`## TL;DR
The page explains the launch plan [1].

## Summary
The team is preparing screenshots and a store submission [2].

## Key Takeaways

### Launch
- **Screenshots** are still required before submission [2]`)

    expect(parsed.note).toContain('launch plan')
    expect(parsed.note).toContain('store submission')
    expect(parsed.groups).toHaveLength(1)
    expect(parsed.groups[0].heading).toBe('Launch')
  })

  it('returns an empty parse for unstructured streaming text', () => {
    expect(parseSteepedNote('Thinking through the page...')).toEqual({ note: '', groups: [] })
  })
})
