import * as path from 'node:path'
import { existsSync, realpathSync } from 'node:fs'

/** Compare path components, including case-insensitive Windows drive semantics. */
export function directoryContains(
  parent: string,
  candidate: string,
  paths: Pick<typeof path, 'relative' | 'isAbsolute' | 'sep'> = path
): boolean {
  const difference = paths.relative(parent, candidate)
  return (
    difference === '' ||
    (difference !== '..' && !difference.startsWith(`..${paths.sep}`) && !paths.isAbsolute(difference))
  )
}

/** Resolve an existing parent so chooser aliases cannot copy a library into itself. */
export function physicalPath(value: string): string {
  let existing = path.resolve(value)
  const suffix: string[] = []
  while (!existsSync(existing)) {
    const parent = path.dirname(existing)
    if (parent === existing) return path.resolve(value)
    suffix.unshift(path.basename(existing))
    existing = parent
  }
  return path.join(realpathSync(existing), ...suffix)
}
