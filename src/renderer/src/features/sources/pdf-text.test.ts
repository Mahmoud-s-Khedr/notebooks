import { describe, expect, it } from 'vitest'
import { normalizedRectangle, reconstructText, type PdfTextItem } from './pdf-text'
const item = (str: string, x: number, y: number, width = 60, dir = 'ltr'): PdfTextItem => ({
  str,
  transform: [1, 0, 0, 12, x, y],
  width,
  height: 12,
  dir
})
describe('geometry-aware PDF text', () => {
  it('keeps lines, table cells, mixed-language logical strings and region scope', () => {
    const items = [
      item('Header', 0, 100),
      item('Row one', 0, 80),
      item('value', 100, 80),
      item('مرحبا English', 0, 60, 150, 'rtl')
    ]
    expect(reconstructText(items)).toBe('Header\nRow one\tvalue\nمرحبا English')
    expect(reconstructText(items, { x: 0, y: 75, width: 70, height: 20 })).toBe('Row one')
  })
  it('groups persistent prose columns instead of alternating their lines', () => {
    const items = [100, 80, 60].flatMap((y, i) => [
      item(`Left column long sentence ${i}`, 0, y, 100),
      item(`Right column long sentence ${i}`, 180, y, 100)
    ])
    expect(reconstructText(items)).toBe(
      'Left column long sentence 0\nLeft column long sentence 1\nLeft column long sentence 2\n\nRight column long sentence 0\nRight column long sentence 1\nRight column long sentence 2'
    )
  })
  it.each([
    [0, 0, 10, 20],
    [10, 20, 0, 0],
    [0, 20, 10, 0],
    [10, 0, 0, 20]
  ])('normalizes %j', (x1, y1, x2, y2) => {
    expect(normalizedRectangle({ x: x1, y: y1 }, { x: x2, y: y2 })).toEqual({ x: 0, y: 0, width: 10, height: 20 })
  })
})
