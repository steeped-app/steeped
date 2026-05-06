import { describe, expect, it } from 'vitest'
import { DEFAULT_PALETTE_ID, applyPalette, getThemePalette } from './theme'

describe('theme palettes', () => {
  it('falls back to the default palette for unknown ids', () => {
    expect(getThemePalette('missing').id).toBe(DEFAULT_PALETTE_ID)
  })

  it('applies palette variables to a root element', () => {
    const root = document.createElement('html')

    applyPalette('graphite-brass', false, root)

    expect(root.dataset.stPalette).toBe('graphite-brass')
    expect(root.classList.contains('dark')).toBe(false)
    expect(root.style.getPropertyValue('--st-accent')).toBe('#8A6A25')
    expect(root.style.getPropertyValue('--st-source-accent')).toBe('#426F64')
  })

  it('toggles dark mode variables for the selected palette', () => {
    const root = document.createElement('html')

    applyPalette('ink-fern', true, root)

    expect(root.classList.contains('dark')).toBe(true)
    expect(root.style.getPropertyValue('--st-bg')).toBe('#121510')
    expect(root.style.getPropertyValue('--st-accent')).toBe('#9FBD8D')
  })
})
