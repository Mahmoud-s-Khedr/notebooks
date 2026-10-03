/**
 * Machine-readable scenario manifest for the Electron performance runner/CI harness.
 * Keeping the sizes here makes fixture generation repeatable without checking large
 * generated libraries into source control.
 */
const scenarios = [
  { name: 'large-page', notes: 1, blocksPerNote: 4000, assets: 0, search: false },
  { name: 'paginated-notes', notes: 200, blocksPerNote: 8, assets: 0, search: false },
  { name: 'mixed-assets', notes: 150, blocksPerNote: 2, assets: { image: 50, audio: 50, pdf: 50 }, search: false },
  { name: 'active-search', notes: 100, blocksPerNote: 30, assets: 0, search: true }
]
process.stdout.write(`${JSON.stringify({ version: 1, samples: 5, regressionPercent: 25, scenarios }, null, 2)}\n`)
