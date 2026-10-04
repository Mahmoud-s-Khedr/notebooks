import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'
import { createResearchNotebookApi, installResearchNotebookApi } from './test/support'

function BrokenChild(): never {
  throw new Error('Deliberate renderer failure')
}

describe('ErrorBoundary', () => {
  let api: ReturnType<typeof createResearchNotebookApi>

  beforeEach(() => {
    api = installResearchNotebookApi()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => vi.restoreAllMocks())

  it('shows its recovery alert and reports bounded react-render diagnostics without unhandled rejection', async () => {
    api.diagnostics.reportError.mockRejectedValue(new Error('Diagnostics offline'))
    render(
      <ErrorBoundary>
        <BrokenChild />
      </ErrorBoundary>
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong')
    await waitFor(() =>
      expect(api.diagnostics.reportError).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: 'error',
          category: 'react.render',
          message: 'Deliberate renderer failure',
          context: expect.objectContaining({ componentStack: expect.any(String) })
        })
      )
    )
  })
})
