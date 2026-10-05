import { annotate } from './annotate.mjs'
import { marked } from 'marked'
import { chromium } from 'playwright-core'
import { readFile, writeFile, stat } from 'node:fs/promises'
import { resolve, join, extname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
await annotate()
const docs = join(root, 'docs')
const source = await readFile(join(docs, 'user-guide.md'), 'utf8')
const headings = []
const ids = new Set()
const slug = (text) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
const renderer = new marked.Renderer()
renderer.heading = function ({ tokens, depth }) {
  const text = this.parser.parseInline(tokens)
  const id = slug(text.replace(/<[^>]*>/g, ''))
  if (ids.has(id)) throw Error('Duplicate heading ' + id)
  ids.add(id)
  headings.push({ depth, id, text })
  return `<h${depth} id="${id}">${text}</h${depth}>\n`
}
let body = marked.parse(source, { renderer })
let images = 0
for (const m of [...body.matchAll(/<img src="([^"]+)"([^>]*)>/g)]) {
  const path = resolve(docs, m[1])
  if (!path.startsWith(docs + '/')) throw Error('Unsafe image path')
  const bytes = await readFile(path)
  if (!m[2].includes('alt="') || m[2].includes('alt=""')) throw Error('Missing image description')
  const mime = extname(path) === '.svg' ? 'image/svg+xml' : 'image/png'
  body = body.replace(m[0], `<img src="data:${mime};base64,${bytes.toString('base64')}"${m[2]}>`)
  images++
}
body = body.replace(
  /<p>(<img [\s\S]*?>)<\/p>\s*<p><em>(Figure [\s\S]*?)<\/em><\/p>/g,
  '<figure>$1<figcaption>$2</figcaption></figure>'
)
const toc = headings
  .filter((h) => h.depth === 2)
  .map((h) => `<li><a href="#${h.id}">${h.text}</a></li>`)
  .join('')
const css = `*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;color:#192b3b;background:#f4f7fa;font:17px/1.65 system-ui,sans-serif}a{color:#075aa8}a:focus-visible{outline:3px solid #b91c1c;outline-offset:3px}.skip{position:absolute;left:8px;top:-60px}.skip:focus{top:8px}nav{position:fixed;inset:0 auto 0 0;width:265px;overflow:auto;padding:24px;background:#162e42;color:white}nav a{color:#dff1ff;text-decoration:none;font-size:14px}nav li{margin:13px 0}nav ol{padding-left:22px}main{margin:0 0 0 265px;max-width:1240px;background:white;padding:40px 4vw 70px}h1{font-size:36px;line-height:1.2}h2{font-size:27px;margin-top:56px;border-top:2px solid #d6e3ed;padding-top:26px}h3{font-size:21px;margin-top:30px}h1,h2,h3{scroll-margin-top:20px;color:#163d59}p,li{max-width:95ch}li{margin:9px 0}figure{margin:28px 0;padding:12px;border:1px solid #cbd8e4;background:#fafcfe}figure img{display:block;width:auto;max-width:100%;max-height:1000px;margin:auto}figcaption{font-size:14px;line-height:1.5;margin-top:12px;color:#3d5264}table{border-collapse:collapse;width:100%;font-size:15px;line-height:1.5;margin:22px 0}td,th{border:1px solid #cbd8e4;padding:10px;text-align:left;vertical-align:top}th{background:#eaf2f7}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#edf3f7;padding:18px;font-size:14px}code{font-size:.9em;overflow-wrap:anywhere}footer{margin-top:40px;font-size:14px;color:#546a7b}@media(max-width:950px){nav{position:static;width:auto}main{margin:0;padding:25px}body{font-size:16px}}@page{size:A4;margin:14mm 14mm 16mm}@media print{html{scroll-behavior:auto}body{background:white;color:#111;font-size:10pt;line-height:1.45}nav{position:static;background:white;color:#111;width:auto;padding:0;break-after:page}nav a{color:#111;font-size:10pt}nav li{margin:5px 0}nav ol{columns:2;column-gap:10mm}main{margin:0;max-width:none;padding:0}h1{font-size:24pt}h2{font-size:17pt;margin-top:0;padding-top:0;border-top:0;break-before:page}h3{font-size:13pt;margin-top:16pt}h1,h2,h3{break-after:avoid}p,li{orphans:3;widows:3}figure{break-inside:avoid;margin:14pt 0;padding:5pt}figure img{max-width:100%;max-height:155mm}figcaption{font-size:8.5pt;margin-top:6pt}table{font-size:9pt;line-height:1.35}tr{break-inside:avoid}thead{display:table-header-group}td,th{padding:5pt}pre{font-size:8.5pt;break-inside:avoid}a{color:#111;text-decoration:underline}.skip{display:none}footer{font-size:8pt}}`
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Research Notebook 0.1.0 — Tester manual</title><style>${css}</style></head><body><a class="skip" href="#manual">Skip to manual</a><nav aria-label="Contents"><h2>Contents</h2><ol>${toc}</ol><p>Version 0.1.0<br>5 October 2026</p></nav><main id="manual">${body}<footer>Generated from docs/user-guide.md. All illustrated app states come from the isolated demonstration capture.</footer></main></body></html>`
const htmlPath = join(docs, 'user-guide.html')
await writeFile(htmlPath, html)
const browser = await chromium.launch({
  executablePath: process.env.GUIDE_CHROME || '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox']
})
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  await page.context().setOffline(true)
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(pathToFileURL(htmlPath).href)
  await page.locator('img').evaluateAll((imgs) => Promise.all(imgs.map((i) => i.decode())))
  const checks = await page.evaluate(() => ({
    brokenImages: [...document.images].filter((i) => !i.complete || !i.naturalWidth).length,
    missingAnchors: [...document.querySelectorAll('a[href^="#"]')].filter(
      (a) => !document.getElementById(a.getAttribute('href').slice(1))
    ).length,
    figures: document.querySelectorAll('figure').length,
    externalResources: [...document.querySelectorAll('[src],link[href]')].filter((e) =>
      /^(https?:)?\/\//.test(e.getAttribute('src') || e.getAttribute('href') || '')
    ).length
  }))
  if (
    checks.brokenImages ||
    checks.missingAnchors ||
    checks.externalResources ||
    errors.length ||
    checks.figures !== images
  )
    throw Error(JSON.stringify({ checks, errors }))
  await page.pdf({
    path: join(docs, 'user-guide.pdf'),
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
    tagged: true,
    outline: true,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate:
      '<div style="width:100%;font-size:8px;text-align:center;color:#536878">Research Notebook 0.1.0 · Tester manual · <span class="pageNumber"></span> / <span class="totalPages"></span></div>'
  })
  await page.screenshot({ path: join(docs, 'images/guide/html-preview.png'), fullPage: false })
  await page.setViewportSize({ width: 390, height: 844 })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  if (overflow) throw Error('Responsive view overflows')
  console.log(
    JSON.stringify(
      {
        ...checks,
        offline: true,
        responsiveOverflow: overflow,
        pdfBytes: (await stat(join(docs, 'user-guide.pdf'))).size
      },
      null,
      2
    )
  )
} finally {
  await browser.close()
}
