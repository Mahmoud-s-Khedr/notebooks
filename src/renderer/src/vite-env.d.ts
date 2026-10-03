/// <reference types="vite/client" />

import type { ResearchNotebookApi } from '../../shared/domain'

declare global {
  interface Window {
    researchNotebook: ResearchNotebookApi
  }
}

export {}
