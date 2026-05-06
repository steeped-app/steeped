export const IS_MAC =
  typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent || '')

const MAC_SYMBOLS: Record<string, string> = {
  Command: '⌘',
  Cmd: '⌘',
  Alt: '⌥',
  Option: '⌥',
  Ctrl: '⌃',
  Control: '⌃',
  MacCtrl: '⌃',
  Shift: '⇧',
}

export function formatShortcut(raw: string | undefined | null): string {
  if (!raw) return ''
  const parts = raw.split('+').map(p => p.trim()).filter(Boolean)
  if (!IS_MAC) return parts.join('+')
  return parts.map(p => MAC_SYMBOLS[p] ?? p).join('')
}

export async function getPanelShortcut(): Promise<string> {
  try {
    const commands = await chrome.commands.getAll()
    const cmd = commands.find(c => c.name === '_execute_action')
    return formatShortcut(cmd?.shortcut)
  } catch {
    return ''
  }
}
