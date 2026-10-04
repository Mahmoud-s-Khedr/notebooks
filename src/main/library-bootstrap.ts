import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export type LibraryBootstrap = { activeRoot: string; previousRoot: string | null }

/**
 * Read the tiny, user-data-resident pointer without ever trusting an
 * interrupted or malformed file.  Keeping this pure makes startup recovery
 * independently testable from Electron.
 */
export function resolveLibraryBootstrap(defaultRoot: string, bootstrapPath: string): LibraryBootstrap {
  const fallback = resolve(defaultRoot)
  try {
    const parsed = JSON.parse(readFileSync(bootstrapPath, 'utf8')) as {
      activeRoot?: unknown
      previousRoot?: unknown
    }
    if (typeof parsed.activeRoot !== 'string' || !parsed.activeRoot.trim())
      return { activeRoot: fallback, previousRoot: null }
    const activeRoot = resolve(parsed.activeRoot)
    if (!existsSync(join(activeRoot, 'database.sqlite'))) return { activeRoot: fallback, previousRoot: null }
    return {
      activeRoot,
      previousRoot:
        typeof parsed.previousRoot === 'string' && parsed.previousRoot.trim() ? resolve(parsed.previousRoot) : null
    }
  } catch {
    return { activeRoot: fallback, previousRoot: null }
  }
}
