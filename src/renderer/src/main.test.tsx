import React from 'react'
import { expect, it, vi } from 'vitest'
const render = vi.hoisted(() => vi.fn())
vi.mock('react-dom/client', () => ({ createRoot: vi.fn(() => ({ render })) }))
vi.mock('./App', () => ({ App: () => null }))
import { createRoot } from 'react-dom/client'
it('mounts the application into the renderer root under StrictMode', async () => {
  vi.stubGlobal('React', React)
  const root = document.createElement('div')
  root.id = 'root'
  document.body.append(root)
  try {
    await import('./main')
    expect(createRoot).toHaveBeenCalledWith(root)
    expect(render).toHaveBeenCalledOnce()
    expect(render.mock.calls[0][0].type).toBe((await import('react')).StrictMode)
  } finally {
    root.remove()
    vi.unstubAllGlobals()
  }
})
