export interface Chunk {
  id: number
  text: string
}

export type SurfaceKind =
  | 'article'
  | 'discussion-thread'
  | 'issue-thread'
  | 'qa-thread'
  | 'commented-article'
  | 'unknown'

export type SurfaceConfidence = 'low' | 'medium' | 'high'
export type SurfacePagePosition = 'first-page' | 'later-page' | 'unknown'

export interface SurfaceInfo {
  kind: SurfaceKind
  confidence: SurfaceConfidence
  label: string
  reason: string
  rootPostVisible: boolean | 'unknown'
  pagePosition: SurfacePagePosition
  rankingSignals: string[]
}

export interface ExtractionWarning {
  code: 'possible-paywall'
  message: string
}

export interface ExtractionResult {
  title: string
  url: string
  chunks: Chunk[]
  warnings?: ExtractionWarning[]
  surfaceInfo?: SurfaceInfo
}
