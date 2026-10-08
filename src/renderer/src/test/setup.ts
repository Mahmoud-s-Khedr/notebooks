import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

// pdf.js currently uses the proposal implemented by newer Node runtimes.
// Electron's renderer has it, while this jsdom runner may not.
if (!('try' in Promise))
  Object.defineProperty(Promise, 'try', {
    configurable: true,
    value: <T>(callback: () => T | PromiseLike<T>) => Promise.resolve().then(callback)
  })

afterEach(() => cleanup())

beforeEach(() => {
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-density')
})

// Radix and the source viewer need a few browser APIs that jsdom deliberately
// does not implement. These shims only make interactions deterministic; they
// do not pretend to test native canvas rendering.
Object.defineProperty(window, 'requestAnimationFrame', {
  configurable: true,
  value: (callback: FrameRequestCallback) => window.setTimeout(() => callback(Date.now()), 0)
})
Object.defineProperty(window, 'cancelAnimationFrame', { configurable: true, value: window.clearTimeout })

class TestResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
Object.defineProperty(window, 'ResizeObserver', { configurable: true, value: TestResizeObserver })
Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: TestResizeObserver })

if (!HTMLElement.prototype.hasPointerCapture)
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { configurable: true, value: () => false })
if (!HTMLElement.prototype.setPointerCapture)
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: () => undefined })
if (!HTMLElement.prototype.releasePointerCapture)
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', { configurable: true, value: () => undefined })

Object.defineProperty(navigator, 'mediaDevices', {
  configurable: true,
  value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }) }
})

Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  configurable: true,
  value: vi.fn(() => ({ drawImage: vi.fn() }))
})
Object.defineProperty(HTMLCanvasElement.prototype, 'toDataURL', {
  configurable: true,
  value: vi.fn(() => 'data:image/png;base64,renderer-test-capture')
})

if (!window.PointerEvent) {
  class TestPointerEvent extends MouseEvent {
    pointerId: number
    constructor(type: string, input: PointerEventInit = {}) {
      super(type, input)
      this.pointerId = input.pointerId ?? 0
    }
  }
  Object.defineProperty(window, 'PointerEvent', { configurable: true, value: TestPointerEvent })
}
