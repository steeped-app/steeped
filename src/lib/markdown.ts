// Steeped — Markdown Export

interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
}

export function toMarkdown(
  title: string,
  url: string,
  summaryText: string,
  chatMessages: ChatMessage[],
): string {
  let md = `# ${title}\n\n`
  md += `> ${url}\n\n`
  md += `---\n\n`
  md += summaryText + '\n'

  if (chatMessages.length > 0) {
    md += `\n---\n\n## Follow-up\n\n`
    for (const msg of chatMessages) {
      if (msg.role === 'user') {
        md += `**You:** ${msg.text}\n\n`
      } else {
        md += `${msg.text}\n\n`
      }
    }
  }

  md += `\n---\n*Exported from Steeped*\n`
  return md
}

export function downloadMarkdown(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
