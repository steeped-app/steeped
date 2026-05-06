export interface NoteGroup {
  heading: string
  items: string[]
}

export interface ParsedNote {
  note: string
  groups: NoteGroup[]
}

function sectionBody(text: string, heading: string, stopHeadings: string[]): string {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const stops = stopHeadings.map(h => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const stopPattern = stops ? `(?=##\\s+(?:${stops})\\s*\\n|$)` : '$'
  const match = text.match(new RegExp(`##\\s+${escapedHeading}\\s*\\n([\\s\\S]*?)${stopPattern}`, 'i'))
  return match?.[1]?.trim() || ''
}

function parseGroups(section: string): NoteGroup[] {
  const groups: NoteGroup[] = []
  let currentHeading = ''
  let currentItems: string[] = []

  for (const line of section.split('\n')) {
    const headingMatch = line.match(/^###\s+(.+)/)
    if (headingMatch) {
      if (currentHeading || currentItems.length) {
        groups.push({ heading: currentHeading, items: currentItems })
      }
      currentHeading = headingMatch[1].trim()
      currentItems = []
      continue
    }

    if (line.trim().startsWith('- ')) {
      let item = line.trim().replace(/^-\s*/, '')
      item = item.replace(/^\[(DECISION|RISK|FACT|ACTION)\]\s*/i, '')
      currentItems.push(item)
    }
  }

  if (currentHeading || currentItems.length) {
    groups.push({ heading: currentHeading, items: currentItems })
  }

  return groups
}

function splitInlineNote(noteBody: string): ParsedNote {
  const lines = noteBody.split('\n')
  const firstBullet = lines.findIndex(line => line.trim().startsWith('- '))
  if (firstBullet === -1) return { note: noteBody.trim(), groups: [] }

  const note = lines.slice(0, firstBullet).join('\n').trim()
  const bulletSection = lines.slice(firstBullet).join('\n')
  return { note, groups: parseGroups(bulletSection) }
}

export function parseSteepedNote(text: string): ParsedNote {
  const note = sectionBody(text, 'Note', ['What Matters', 'Key Takeaways', 'Summary', 'TL;DR'])
  const whatMatters = sectionBody(text, 'What Matters', ['Key Takeaways', 'Summary', 'TL;DR'])

  if (note || whatMatters) {
    if (note && !whatMatters) return splitInlineNote(note)
    return { note, groups: parseGroups(whatMatters) }
  }

  const legacyTldr = sectionBody(text, 'TL;DR', ['Summary', 'Key Takeaways'])
  const legacySummary = sectionBody(text, 'Summary', ['Key Takeaways'])
  const legacyTakeaways = sectionBody(text, 'Key Takeaways', [])
  const legacyNote = [legacyTldr, legacySummary].filter(Boolean).join(' ')

  return { note: legacyNote, groups: parseGroups(legacyTakeaways) }
}
