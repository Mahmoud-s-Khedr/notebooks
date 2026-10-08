import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserWindow } from 'electron'
import { PdfRenderer } from './pdf-renderer'

const state = vi.hoisted(() => ({
  loadURL: vi.fn(),
  printToPDF: vi.fn(),
  capturePage: vi.fn(),
  resize: vi.fn(),
  toPNG: vi.fn(),
  destroy: vi.fn(),
  isDestroyed: vi.fn(),
  setWindowOpenHandler: vi.fn()
}))
vi.mock('electron', () => ({
  BrowserWindow: vi.fn(function () {
    return {
      loadURL: state.loadURL,
      destroy: state.destroy,
      isDestroyed: state.isDestroyed,
      webContents: {
        printToPDF: state.printToPDF,
        capturePage: state.capturePage,
        setWindowOpenHandler: state.setWindowOpenHandler
      }
    }
  })
}))
beforeEach(() => {
  vi.resetAllMocks()
  state.loadURL.mockResolvedValue(undefined)
  state.isDestroyed.mockReturnValue(false)
  state.printToPDF.mockResolvedValue(Buffer.from('pdf'))
  state.toPNG.mockReturnValue(Buffer.from('png'))
  state.resize.mockReturnValue({ toPNG: state.toPNG })
  state.capturePage.mockResolvedValue({ resize: state.resize })
})
describe('sandboxed PDF windows', () => {
  it('prints markup with tagged A4 output and denies popup windows', async () => {
    await expect(new PdfRenderer().print('<p>Research</p>')).resolves.toEqual(Buffer.from('pdf'))
    expect(BrowserWindow).toHaveBeenCalledWith({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    expect(state.setWindowOpenHandler.mock.calls[0][0]()).toEqual({ action: 'deny' })
    expect(decodeURIComponent(state.loadURL.mock.calls[0][0])).toContain('<body><p>Research</p></body>')
    expect(state.printToPDF).toHaveBeenCalledWith({
      printBackground: true,
      preferCSSPageSize: true,
      pageSize: 'A4',
      generateTaggedPDF: true
    })
    expect(state.destroy).toHaveBeenCalledOnce()
  })
  it('captures and resizes a PDF thumbnail', async () => {
    await expect(new PdfRenderer().thumbnail('data:application/pdf;base64,abc', 120, 80)).resolves.toEqual(
      Buffer.from('png')
    )
    expect(state.loadURL).toHaveBeenCalledWith('data:application/pdf;base64,abc')
    expect(state.resize).toHaveBeenCalledWith({ width: 120, height: 80, quality: 'good' })
    expect(state.destroy).toHaveBeenCalledOnce()
  })
  it.each(['print', 'thumbnail'] as const)('destroys the window when %s loading or rendering fails', async (method) => {
    const failure = new Error('renderer failed')
    state.loadURL.mockRejectedValueOnce(failure)
    const run = () =>
      method === 'print' ? new PdfRenderer().print('') : new PdfRenderer().thumbnail('data:pdf', 32, 32)
    await expect(run()).rejects.toBe(failure)
    expect(state.destroy).toHaveBeenCalledOnce()
    state.destroy.mockClear()
    state.printToPDF.mockRejectedValueOnce(failure)
    state.capturePage.mockRejectedValueOnce(failure)
    await expect(run()).rejects.toBe(failure)
    expect(state.destroy).toHaveBeenCalledOnce()
    state.destroy.mockClear()
    state.isDestroyed.mockReturnValue(true)
    await run()
    expect(state.destroy).not.toHaveBeenCalled()
  })
  it('escapes text and treats missing values as empty', () => {
    expect(PdfRenderer.text(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;')
    expect(PdfRenderer.text(null)).toBe('')
    expect(PdfRenderer.text(42)).toBe('42')
  })
})
