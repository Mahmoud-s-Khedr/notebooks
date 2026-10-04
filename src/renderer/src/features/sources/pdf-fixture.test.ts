import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'

describe('the committed PDF fixture', () => {
  it('is a real PDF with extractable source text', async () => {
    const bytes = new Uint8Array(readFileSync(resolve('src/renderer/src/test/fixtures/source.pdf')))
    const options = { data: bytes, disableWorker: true } as Parameters<typeof pdfjs.getDocument>[0] & {
      disableWorker: boolean
    }
    const loading = pdfjs.getDocument(options)
    const document = await loading.promise
    const page = await document.getPage(1)
    const text = await page.getTextContent()

    expect(document.numPages).toBe(1)
    expect(text.items.map((item) => ('str' in item ? item.str : '')).join(' ')).toContain('Fixture PDF text')
    await loading.destroy()
  })
})
