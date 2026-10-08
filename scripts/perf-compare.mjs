import { readFile, writeFile } from 'node:fs/promises'
const [
  beforePath = 'docs/performance-before.json',
  afterPath = 'docs/performance-after.json',
  outputPath = 'docs/performance-comparison.json'
] = process.argv.slice(2)
const before = JSON.parse(await readFile(beforePath, 'utf8'))
const after = JSON.parse(await readFile(afterPath, 'utf8'))
if (before.cpu !== after.cpu || before.platform !== after.platform)
  throw Error('Use the same machine/platform for comparisons')
const comparisons = after.results.flatMap((result) => {
  const prior = before.results.find((r) => r.scenario === result.scenario)
  return Object.entries(result.medians)
    .filter(
      ([metric, value]) => value !== null && prior?.medians[metric] !== null && prior?.medians[metric] !== undefined
    )
    .map(([metric, value]) => {
      const baseline = prior.medians[metric]
      const percent = baseline ? (100 * (value - baseline)) / baseline : value ? null : 0
      return {
        scenario: result.scenario,
        metric,
        before: baseline,
        after: value,
        percent: percent === null ? null : Math.round(percent * 10) / 10,
        overBudget: baseline ? value > baseline * 1.25 : value > 0
      }
    })
})
const report = {
  platform: after.platform,
  cpu: after.cpu,
  budgetPercent: 25,
  beforeRevision: before.revision,
  afterRevision: after.revision,
  comparisons,
  regressions: comparisons.filter((c) => c.overBudget)
}
await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
