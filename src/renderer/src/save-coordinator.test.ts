import { describe, expect, it, vi } from 'vitest'
import { SaveCoordinator } from './save-coordinator'

describe('application save boundary', () => {
  it('shares simultaneous navigation and stop requests and waits for editors first', async () => {
    const saves = new SaveCoordinator()
    let resolve!: () => void
    const editor = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r
        })
    )
    const stop = vi.fn().mockResolvedValue(undefined)
    saves.editors.set('dirty', editor)
    saves.setRecorder({ start: vi.fn(), stop })
    const first = saves.flush()
    const second = saves.flush()
    expect(first).toBe(second)
    expect(stop).not.toHaveBeenCalled()
    resolve()
    await first
    expect(editor).toHaveBeenCalledTimes(1)
    expect(stop).toHaveBeenCalledTimes(1)
  })
  it('rejects navigation on failed save and permits retry', async () => {
    const saves = new SaveCoordinator()
    const stop = vi.fn().mockRejectedValueOnce(new Error('Disk full')).mockResolvedValue(undefined)
    saves.setRecorder({ start: vi.fn(), stop })
    await expect(saves.flush()).rejects.toThrow('Disk full')
    await expect(saves.flush()).resolves.toBeUndefined()
    expect(stop).toHaveBeenCalledTimes(2)
  })
})
