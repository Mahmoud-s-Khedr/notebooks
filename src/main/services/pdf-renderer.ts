import { BrowserWindow } from 'electron'

const escape = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!
  )

/** Sandboxed hidden renderer used for all production PDF generation. */
export class PdfRenderer {
  async print(markup: string): Promise<Buffer> {
    const window = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    try {
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      await window.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html><head><meta charset="utf-8"><style>@page{margin:16mm}body{font:14px system-ui;color:#171717}h1{font-size:24px}h2{font-size:19px;break-after:avoid}h3{font-size:16px;break-after:avoid}section{break-inside:avoid}img{max-width:100%;max-height:600px} .label{color:#555;font-size:12px}</style></head><body>${markup}</body></html>`)}`
      )
      return await window.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true })
    } finally {
      if (!window.isDestroyed()) window.destroy()
    }
  }
  async thumbnail(pdfDataUrl: string, width: number, height: number): Promise<Buffer> {
    const window = new BrowserWindow({
      show: false,
      width,
      height,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    try {
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      await window.loadURL(pdfDataUrl)
      return (await window.webContents.capturePage()).resize({ width, height, quality: 'good' }).toPNG()
    } finally {
      if (!window.isDestroyed()) window.destroy()
    }
  }
  static text(value: unknown): string {
    return escape(value)
  }
}
