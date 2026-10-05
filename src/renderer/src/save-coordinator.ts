import { createContext, useContext } from 'react'

/** App-owned save boundary. Recording and editor operations survive view changes. */
export class SaveCoordinator {
  editors = new Map<string, () => Promise<void>>()
  recorder: { start: (noteId: string) => Promise<void>; stop: () => Promise<void> } | null = null
  setRecorder(recorder: NonNullable<SaveCoordinator['recorder']>): void {
    this.recorder = recorder
  }
  private pending: Promise<void> | null = null
  flush(): Promise<void> {
    if (this.pending) return this.pending
    this.pending = (async () => {
      for (const save of [...this.editors.values()]) await save()
      await this.recorder?.stop()
    })().finally(() => {
      this.pending = null
    })
    return this.pending
  }
}
export const SaveContext = createContext(new SaveCoordinator())
export const useSaves = () => useContext(SaveContext)
