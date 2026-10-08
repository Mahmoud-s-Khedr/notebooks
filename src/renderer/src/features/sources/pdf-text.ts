/** PDF.js strings are already logical text, including Arabic. Never reverse them. */
export type PdfTextItem = {
  str: string
  transform: number[]
  width: number
  height: number
  dir: string
  hasEOL?: boolean
}
export type PdfBounds = { x: number; y: number; width: number; height: number }
export function reconstructText(items: readonly PdfTextItem[], bounds?: PdfBounds): string {
  const selected = items.filter(
    (item) =>
      item.str &&
      (!bounds ||
        (item.transform[4] < bounds.x + bounds.width &&
          item.transform[4] + item.width > bounds.x &&
          item.transform[5] < bounds.y + bounds.height &&
          item.transform[5] + item.height > bounds.y))
  )
  const lines: PdfTextItem[][] = []
  for (const item of [...selected].sort((a, b) => b.transform[5] - a.transform[5])) {
    const line = lines.find(
      (line) => Math.abs(line[0].transform[5] - item.transform[5]) <= Math.max(2, item.height * 0.35)
    )
    if (line) line.push(item)
    else lines.push([item])
  }
  // A persistent gutter between long text cells suggests prose columns. Short
  // cells remain rows with tabs, preserving table structure for human review.
  if (!bounds && lines.length >= 3) {
    const gaps = lines.flatMap((line) => {
      const sorted = [...line].sort((a, b) => a.transform[4] - b.transform[4])
      return sorted.slice(1).flatMap((item, index) => {
        const previous = sorted[index]
        const left = previous.transform[4] + previous.width
        const right = item.transform[4]
        return right - left > Math.max(item.height, previous.height) * 2 &&
          previous.str.length > 18 &&
          item.str.length > 18
          ? [{ left, right }]
          : []
      })
    })
    for (const gap of gaps) {
      const split = (gap.left + gap.right) / 2
      if (gaps.filter((g) => g.left <= split && g.right >= split).length < Math.max(3, lines.length * 0.7)) continue
      if (selected.some((item) => item.transform[4] < split && item.transform[4] + item.width > split)) continue
      const left = selected.filter((item) => item.transform[4] < split)
      const right = selected.filter((item) => item.transform[4] >= split)
      const rtl = selected.filter((i) => i.dir === 'rtl').length > selected.length / 2
      return (rtl ? [right, left] : [left, right]).map((column) => reconstructText(column)).join('\n\n')
    }
  }
  return lines
    .map((line) => {
      const rtl =
        line.filter((i) => i.dir === 'rtl').reduce((n, i) => n + i.str.length, 0) >
        line.filter((i) => i.dir !== 'rtl').reduce((n, i) => n + i.str.length, 0)
      line.sort((a, b) => (rtl ? b.transform[4] - a.transform[4] : a.transform[4] - b.transform[4]))
      return line
        .map((item, index) => {
          const previous = line[index - 1]
          if (!previous) return item.str
          const gap = rtl
            ? previous.transform[4] - item.transform[4] - item.width
            : item.transform[4] - previous.transform[4] - previous.width
          const separator = previous.hasEOL
            ? '\n'
            : gap > Math.max(item.height, previous.height) * 2
              ? '\t'
              : gap > 1
                ? ' '
                : ''
          return separator + item.str
        })
        .join('')
    })
    .join('\n')
}
export function normalizedRectangle(start: { x: number; y: number }, end: { x: number; y: number }): PdfBounds {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y)
  }
}
