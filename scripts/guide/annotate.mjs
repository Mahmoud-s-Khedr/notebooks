import { readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const xml = (text) => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

export async function annotate() {
  const out = join(root, 'docs/images/guide')
  const index = JSON.parse(await readFile(join(out, 'capture-index.json'), 'utf8'))
  if (!index.complete) throw Error('Refusing to build from an incomplete capture.')
  for (const capture of index.captures) {
    const { id, width, height, markers } = capture
    const crop = capture.displayCrop || { x: 0, y: 0, width, height }
    // A top gutter and markers above the outline keep button/field text unobscured.
    const view = { x: crop.x, y: crop.y - 30, width: crop.width, height: crop.height + 60 }
    const overlay = markers
      .map((r) => {
        const x = Math.max(crop.x + 3, r.x - 3)
        const y = Math.max(crop.y + 3, r.y - 3)
        const w = Math.min(crop.x + crop.width - x - 3, r.width + 6)
        const h = Math.min(crop.y + crop.height - y - 3, r.height + 6)
        let cx = Math.min(crop.x + crop.width - 14, x + w)
        let cy = Math.max(view.y + 14, y - 14)
        // Place dense Diagnostics-row markers beside their controls, away from neighboring labels.
        if (id === '26-diagnostics' && [1, 2, 4, 5].includes(r.n)) {
          cx = r.n === 1 ? Math.max(crop.x + 12, r.x - 14) : r.x + r.width + 14
          cy = r.y + r.height / 2
        }
        if (id === '11-capture-controls' && r.n === 7) cy = height + 14
        const connectorX = Math.max(x, Math.min(x + w, cx))
        const connectorY = Math.max(y, Math.min(y + h, cy))
        const outline =
          r.shape === 'circle'
            ? `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}"/>`
            : `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4"/>`
        return `<g fill="none" stroke="white" stroke-width="5">${outline}</g><g fill="none" stroke="#d42816" stroke-width="2.5">${outline}</g><line x1="${cx}" y1="${cy}" x2="${connectorX}" y2="${connectorY}" stroke="#b91c1c" stroke-width="2"/><circle cx="${cx}" cy="${cy}" r="12" fill="#b91c1c" stroke="white" stroke-width="2"/><text x="${cx}" y="${cy + 4}" text-anchor="middle" font-family="Arial,sans-serif" font-size="13" font-weight="bold" fill="white">${r.n}</text>`
      })
      .join('')
    const wrap = (body) =>
      `<svg xmlns="http://www.w3.org/2000/svg" width="${view.width}" height="${view.height}" viewBox="${view.x} ${view.y} ${view.width} ${view.height}" role="img"><title>${xml(id + ': ' + markers.map((r) => r.n + ' ' + r.description).join('; '))}</title>${body}</svg>`
    await writeFile(join(out, 'overlays', id + '.svg'), wrap(overlay))
    const original = await readFile(join(out, capture.originalPath || 'originals/' + id + '.png'))
    if (original.readUInt32BE(16) !== width || original.readUInt32BE(20) !== height)
      throw Error('Original dimensions disagree with capture index: ' + id)
    const png = original.toString('base64')
    await writeFile(
      join(out, id + '.svg'),
      wrap(
        `<rect x="${view.x}" y="${view.y}" width="${view.width}" height="${view.height}" fill="white"/><defs><clipPath id="photo"><rect x="${crop.x}" y="${crop.y}" width="${crop.width}" height="${crop.height}"/></clipPath></defs><image width="${width}" height="${height}" href="data:image/png;base64,${png}" clip-path="url(#photo)"/>${overlay}`
      )
    )
  }
}
