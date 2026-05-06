export type ThemePaletteId = 'classic' | 'ink-fern' | 'graphite-brass' | 'mineral-neutral'

type ThemeMode = 'light' | 'dark'
type ThemeVars = Record<string, string>

export interface ThemePalette {
  id: ThemePaletteId
  name: string
  shortName: string
  description: string
  swatches: string[]
  vars: Record<ThemeMode, ThemeVars>
}

export const DEFAULT_PALETTE_ID: ThemePaletteId = 'ink-fern'
export const THEME_PALETTE_STORAGE_KEY = 'themePalette'
export const DARK_MODE_STORAGE_KEY = 'darkMode'
export const THEME_PALETTE_CACHE_KEY = 'st-theme-palette'
export const DARK_MODE_CACHE_KEY = 'st-dark'

const commonLightVars: ThemeVars = {
  '--st-error': '#C53030',
  '--st-error-bg': '#FEF2F2',
  '--st-error-border': '#FECACA',
  '--st-error-text': '#7F1D1D',
  '--st-success': '#16A34A',
  '--st-success-bg': '#F0FDF4',
}

const commonDarkVars: ThemeVars = {
  '--st-error': '#FC8181',
  '--st-error-bg': '#2D1B1B',
  '--st-error-border': '#5C2626',
  '--st-error-text': '#FECACA',
  '--st-success': '#34D399',
  '--st-success-bg': '#12291F',
}

export const THEME_PALETTES: ThemePalette[] = [
  {
    id: 'classic',
    name: 'Steeped Classic',
    shortName: 'Classic',
    description: 'The original warm paper and blue-ink dark mode.',
    swatches: ['#EDEBE2', '#07101C', '#56C7C1', '#0F766E'],
    vars: {
      light: {
        ...commonLightVars,
        '--st-bg': '#EDEBE2',
        '--st-bg-surface': '#E2DFD3',
        '--st-bg-elevated': '#FAF8EF',
        '--st-text-primary': '#141717',
        '--st-text-secondary': '#4D5556',
        '--st-text-tertiary': '#7A8281',
        '--st-accent': '#0F766E',
        '--st-accent-contrast': '#FFFFFF',
        '--st-accent-light': '#C9EFE8',
        '--st-accent-hover': '#0B625D',
        '--st-accent-faint': '#EEF8F3',
        '--st-border': '#CCC9BD',
        '--st-border-light': '#DBD8CC',
        '--st-source-accent': '#0F766E',
      },
      dark: {
        ...commonDarkVars,
        '--st-bg': '#07101C',
        '--st-bg-surface': '#0B1730',
        '--st-bg-elevated': '#101D36',
        '--st-text-primary': '#F6F8F3',
        '--st-text-secondary': '#BAC3D2',
        '--st-text-tertiary': '#7F8DA0',
        '--st-accent': '#56C7C1',
        '--st-accent-contrast': '#07101C',
        '--st-accent-light': '#123E4C',
        '--st-accent-hover': '#7CE5DE',
        '--st-accent-faint': '#0D2A38',
        '--st-border': '#24314E',
        '--st-border-light': '#16233D',
        '--st-source-accent': '#56C7C1',
      },
    },
  },
  {
    id: 'ink-fern',
    name: 'Ink + Fern',
    shortName: 'Ink',
    description: 'Warm charcoal, muted green, and brass source lines.',
    swatches: ['#121510', '#1B2119', '#9FBD8D', '#D1A85F'],
    vars: {
      light: {
        ...commonLightVars,
        '--st-bg': '#F3F0E8',
        '--st-bg-surface': '#E6E9DE',
        '--st-bg-elevated': '#FBFAF5',
        '--st-text-primary': '#171915',
        '--st-text-secondary': '#4D554A',
        '--st-text-tertiary': '#7A8173',
        '--st-accent': '#3F725B',
        '--st-accent-contrast': '#FBFAF5',
        '--st-accent-light': '#D9E7D5',
        '--st-accent-hover': '#335F4B',
        '--st-accent-faint': '#EDF4E9',
        '--st-border': '#C8CBBF',
        '--st-border-light': '#D8DACD',
        '--st-source-accent': '#B5853F',
      },
      dark: {
        ...commonDarkVars,
        '--st-bg': '#121510',
        '--st-bg-surface': '#1B2119',
        '--st-bg-elevated': '#222A20',
        '--st-text-primary': '#F2EFE6',
        '--st-text-secondary': '#C7CBBC',
        '--st-text-tertiary': '#8E9685',
        '--st-accent': '#9FBD8D',
        '--st-accent-contrast': '#121510',
        '--st-accent-light': '#2F3B2D',
        '--st-accent-hover': '#B3CE9F',
        '--st-accent-faint': '#20291E',
        '--st-border': '#323B2F',
        '--st-border-light': '#263023',
        '--st-source-accent': '#D1A85F',
      },
    },
  },
  {
    id: 'graphite-brass',
    name: 'Graphite + Brass',
    shortName: 'Brass',
    description: 'Editorial graphite with stronger brass contrast.',
    swatches: ['#11100E', '#252119', '#D0A85F', '#87B2A3'],
    vars: {
      light: {
        ...commonLightVars,
        '--st-bg': '#F4F2EC',
        '--st-bg-surface': '#E7E3D9',
        '--st-bg-elevated': '#FFFDF7',
        '--st-text-primary': '#171615',
        '--st-text-secondary': '#55514A',
        '--st-text-tertiary': '#7C776D',
        '--st-accent': '#8A6A25',
        '--st-accent-contrast': '#FFFDF7',
        '--st-accent-light': '#EAD9AD',
        '--st-accent-hover': '#73571D',
        '--st-accent-faint': '#F6EDD7',
        '--st-border': '#CDC7BA',
        '--st-border-light': '#DED8CC',
        '--st-source-accent': '#426F64',
      },
      dark: {
        ...commonDarkVars,
        '--st-bg': '#11100E',
        '--st-bg-surface': '#1B1915',
        '--st-bg-elevated': '#252119',
        '--st-text-primary': '#F4EFE3',
        '--st-text-secondary': '#C9C1B0',
        '--st-text-tertiary': '#948A78',
        '--st-accent': '#D0A85F',
        '--st-accent-contrast': '#11100E',
        '--st-accent-light': '#40341E',
        '--st-accent-hover': '#E3BD74',
        '--st-accent-faint': '#2A2419',
        '--st-border': '#3B3427',
        '--st-border-light': '#2D281F',
        '--st-source-accent': '#87B2A3',
      },
    },
  },
  {
    id: 'mineral-neutral',
    name: 'Mineral Neutral',
    shortName: 'Mineral',
    description: 'A cleaner teal family with less blue in the dark mode.',
    swatches: ['#101314', '#1A2020', '#7FBBAE', '#C4A05D'],
    vars: {
      light: {
        ...commonLightVars,
        '--st-bg': '#F4F3EF',
        '--st-bg-surface': '#E5E9E4',
        '--st-bg-elevated': '#FCFBF6',
        '--st-text-primary': '#151819',
        '--st-text-secondary': '#4D5555',
        '--st-text-tertiary': '#78807F',
        '--st-accent': '#306F66',
        '--st-accent-contrast': '#FCFBF6',
        '--st-accent-light': '#D4E5E1',
        '--st-accent-hover': '#275E56',
        '--st-accent-faint': '#ECF3EF',
        '--st-border': '#C8CECA',
        '--st-border-light': '#D8DDD9',
        '--st-source-accent': '#A78549',
      },
      dark: {
        ...commonDarkVars,
        '--st-bg': '#101314',
        '--st-bg-surface': '#1A2020',
        '--st-bg-elevated': '#222A2A',
        '--st-text-primary': '#F0F2EC',
        '--st-text-secondary': '#C3CAC3',
        '--st-text-tertiary': '#87928E',
        '--st-accent': '#7FBBAE',
        '--st-accent-contrast': '#101314',
        '--st-accent-light': '#29403D',
        '--st-accent-hover': '#96CBBF',
        '--st-accent-faint': '#1E302D',
        '--st-border': '#30403E',
        '--st-border-light': '#24322F',
        '--st-source-accent': '#C4A05D',
      },
    },
  },
]

export function getThemePalette(id: unknown): ThemePalette {
  return THEME_PALETTES.find(palette => palette.id === id) || THEME_PALETTES.find(palette => palette.id === DEFAULT_PALETTE_ID)!
}

export function cacheThemePreference(paletteId: ThemePaletteId, isDark: boolean) {
  try {
    localStorage.setItem(THEME_PALETTE_CACHE_KEY, paletteId)
    localStorage.setItem(DARK_MODE_CACHE_KEY, String(isDark))
  } catch {}
}

export function readCachedThemePreference(): { paletteId: ThemePaletteId; isDark: boolean } {
  let paletteId: ThemePaletteId = DEFAULT_PALETTE_ID
  let isDark = true

  try {
    paletteId = getThemePalette(localStorage.getItem(THEME_PALETTE_CACHE_KEY)).id
    isDark = localStorage.getItem(DARK_MODE_CACHE_KEY) !== 'false'
  } catch {}

  return { paletteId, isDark }
}

export function applyPalette(paletteId: ThemePaletteId, isDark: boolean, root = document.documentElement) {
  const palette = getThemePalette(paletteId)
  const mode: ThemeMode = isDark ? 'dark' : 'light'

  root.classList.toggle('dark', isDark)
  root.dataset.stPalette = palette.id
  for (const [name, value] of Object.entries(palette.vars[mode])) {
    root.style.setProperty(name, value)
  }
  cacheThemePreference(palette.id, isDark)
}

export function applyCachedTheme(root = document.documentElement) {
  const { paletteId, isDark } = readCachedThemePreference()
  applyPalette(paletteId, isDark, root)
}
