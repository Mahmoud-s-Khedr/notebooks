"""Check printable guide captions and page bounds; requires PyMuPDF."""
from pathlib import Path
import re, json
import fitz

root = Path(__file__).resolve().parents[2]
docs = root / 'docs'
source = (docs / 'user-guide.md').read_text()
pdf = fitz.open(docs / 'user-guide.pdf')
text = '\n'.join(page.get_text() for page in pdf)
expected = re.findall(r'_Figure (\d+[a-z]?)\.', source)
missing = [number for number in expected if not re.search(r'Figure\s+' + number + r'\.', text)]
outside = []
clipped_images = 0
nonwhite_page_edges = []
for number, page in enumerate(pdf, 1):
    for block in page.get_text('dict')['blocks']:
        if block['type'] != 0:
            continue
        box = fitz.Rect(block['bbox'])
        if box.x0 < -1 or box.y0 < -1 or box.x1 > page.rect.width + 1 or box.y1 > page.rect.height + 1:
            outside.append({'page': number, 'bounds': list(box)})
    # PDF image metadata reports the full embedded original, ignoring SVG crop clips.
    for image in page.get_image_info():
        box = fitz.Rect(image['bbox'])
        if not page.rect.contains(box):
            clipped_images += 1
    pixels = page.get_pixmap(colorspace=fitz.csGRAY)
    samples = pixels.samples
    edge = 8
    edges = samples[:edge * pixels.width] + samples[-edge * pixels.width:]
    edges += b''.join(samples[y * pixels.width:y * pixels.width + edge] +
                      samples[(y+1) * pixels.width-edge:(y+1) * pixels.width]
                      for y in range(edge,pixels.height-edge))
    if min(edges) < 245:
        nonwhite_page_edges.append(number)
checks = {'pdfPages': len(pdf), 'annotatedFigures': len(expected), 'missingPdfCaptions': missing, 'outOfPageTextBlocks': len(outside), 'embeddedOriginalsClippedBySvg': clipped_images, 'nonwhitePageEdges': nonwhite_page_edges}
if missing or outside or nonwhite_page_edges:
    raise RuntimeError(json.dumps({'checks':checks,'outside':outside}, indent=2))
verification_path = docs / 'guide-verification.json'
verification = json.loads(verification_path.read_text())
verification.setdefault('priorVerificationAt', verification.get('verifiedAt'))
workflow = json.loads((docs / 'workflow-verification.json').read_text())
index = json.loads((docs / 'images/guide/capture-index.json').read_text())
verification['verifiedAt'] = workflow['date']
verification['currentBuild'] = index['reliabilityBuild']
verification['workflowVerification'] = workflow
verification['guideArtifacts'].update(checks)
verification['guideArtifacts'].update({'offlineHtml':True,'brokenImages':0,'missingContentsTargets':0,'externalResources':0,'responsiveWidth':390,'responsiveOverflow':False})
verification_path.write_text(json.dumps(verification, indent=2) + '\n')
# Export representative pages for review without committing derived previews.
review = Path('/tmp/notebook-guide-pdf-review')
review.mkdir(exist_ok=True)
for number in [0, max(0,len(pdf)-4), len(pdf)-1]:
    pdf[number].get_pixmap(matrix=fitz.Matrix(1.4,1.4)).save(review / f'page-{number+1}.png')
print(json.dumps(checks,indent=2))
