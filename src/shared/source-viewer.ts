/** A renderer-facing contract; new source types can implement it without changing capture provenance. */
export interface SourceViewer {
  readonly sourceType: string
  open(source: { id: string; dataUrl: string; title: string }, location?: { pdfPage?: number }): void
  getLocation(): { pdfPage?: number }
}

export interface PdfSourceViewer extends SourceViewer {
  readonly sourceType: 'pdf'
}
