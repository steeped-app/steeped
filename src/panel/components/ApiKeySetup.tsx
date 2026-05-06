import { useEffect, useState } from 'react'
import {
  DARK_MODE_STORAGE_KEY,
  DEFAULT_PALETTE_ID,
  THEME_PALETTES,
  THEME_PALETTE_STORAGE_KEY,
  applyPalette,
  getThemePalette,
  type ThemePaletteId,
} from '../../lib/theme'

interface Props {
  onSaved: () => void
}

export default function ApiKeySetup({ onSaved }: Props) {
  const [key, setKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [paletteId, setPaletteId] = useState<ThemePaletteId>(DEFAULT_PALETTE_ID)
  const [isDark, setIsDark] = useState(true)

  useEffect(() => {
    chrome.storage.local.get([THEME_PALETTE_STORAGE_KEY, DARK_MODE_STORAGE_KEY]).then(({ themePalette, darkMode }) => {
      const nextPalette = getThemePalette(themePalette).id
      const nextDark = darkMode ?? true
      setPaletteId(nextPalette)
      setIsDark(nextDark)
      applyPalette(nextPalette, nextDark)
    })
  }, [])

  const handleSave = async () => {
    const trimmed = key.trim()
    if (!trimmed.startsWith('sk-ant-')) {
      setError('Key should start with sk-ant-')
      return
    }
    setSaving(true)
    setError('')
    await chrome.storage.local.set({ apiKey: trimmed })
    onSaved()
  }

  const handlePalette = async (nextPalette: ThemePaletteId) => {
    setPaletteId(nextPalette)
    applyPalette(nextPalette, isDark)
    await chrome.storage.local.set({ [THEME_PALETTE_STORAGE_KEY]: nextPalette })
  }

  const openFullSetup = async () => {
    try {
      await chrome.runtime.openOptionsPage()
    } catch {
      await chrome.tabs.create({ url: chrome.runtime.getURL('settings/settings.html?welcome=1') })
    }
  }

  return (
    <div className="flex-1 flex flex-col justify-center px-7 py-6">
      <div className="w-9 h-9 bg-st-accent-light rounded-[9px] flex items-center justify-center mb-5">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-st-accent">
          <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
        </svg>
      </div>
      <h2 className="text-[16px] font-semibold mb-1.5">Add your key</h2>
      <p className="text-[13px] text-st-text-secondary leading-relaxed mb-6">
        Steeped uses Anthropic. Your key stays in Chrome.
      </p>

      <div className="mb-5 rounded-lg border border-st-border bg-st-bg-surface p-2.5">
        <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.08em] text-st-text-tertiary">Choose a look</div>
        <div className="grid grid-cols-2 gap-1.5">
          {THEME_PALETTES.map(palette => (
            <button
              key={palette.id}
              type="button"
              onClick={() => handlePalette(palette.id)}
              className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-left text-[11px] font-semibold transition-colors ${
                paletteId === palette.id
                  ? 'border-st-accent bg-st-accent-faint text-st-text-primary'
                  : 'border-st-border-light bg-st-bg-elevated text-st-text-secondary hover:text-st-text-primary'
              }`}
            >
              <span className="flex -space-x-1">
                {palette.swatches.slice(0, 3).map(color => (
                  <span
                    key={color}
                    className="h-3 w-3 rounded-full border border-st-border"
                    style={{ background: color }}
                  />
                ))}
              </span>
              {palette.shortName}
            </button>
          ))}
        </div>
      </div>

      <label className="text-[11px] font-medium text-st-text-secondary mb-1.5 block">Anthropic key</label>
      <input
        type="password"
        value={key}
        onChange={(e) => { setKey(e.target.value); setError('') }}
        onKeyDown={(e) => e.key === 'Enter' && handleSave()}
        placeholder="sk-ant-api03-..."
        className="w-full px-3 py-2.5 text-[13px] font-sans bg-st-bg-elevated border border-st-border rounded-lg text-st-text-primary placeholder:text-st-text-tertiary outline-none transition-colors focus:border-st-accent focus:ring-[3px] focus:ring-st-accent-faint mb-3"
        autoFocus
      />

      {error && (
        <p className="text-[12px] text-st-error mb-3">{error}</p>
      )}

      <button
        onClick={handleSave}
        disabled={!key.trim() || saving}
        className="w-full py-2.5 text-[13px] font-semibold bg-st-accent text-st-accent-contrast rounded-lg hover:bg-st-accent-hover transition-colors disabled:opacity-50"
      >
        {saving ? 'Saving...' : 'Save key'}
      </button>

      <div className="mt-7 pt-5 border-t border-st-border-light">
        <p className="text-[11.5px] text-st-text-tertiary leading-relaxed">
          Page text goes to Anthropic only when you ask. Steeped has no server.
        </p>
        <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1">
          <a
            href="https://console.anthropic.com/settings/keys"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[12px] font-medium text-st-accent hover:text-st-accent-hover"
          >
            Get an API key
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 17l9.2-9.2M17 17V7H7" />
            </svg>
          </a>
          <button
            type="button"
            onClick={openFullSetup}
            className="text-[12px] font-medium text-st-accent hover:text-st-accent-hover"
          >
            Full setup
          </button>
        </div>
      </div>
    </div>
  )
}
