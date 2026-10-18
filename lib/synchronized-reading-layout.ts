export type SynchronizedLayoutFragment = {
  text: string
  page: number
  column?: number
  row: number
  segment: 'right' | 'center' | 'left'
  rowMode: 'justify' | 'right' | 'segments'
  layoutPadding?: Record<'right' | 'center' | 'left', { before: string[]; after: string[] }>
  breakAfter?: 'open' | 'closed'
  pageBreakBefore?: boolean
}

export type SynchronizedToken = {
  index: number
  text: string
  start: number
  end: number
  confidence?: number
  source?: string
  layoutSource?: 'tikkun-rows' | 'text2video-flow'
  page?: number
  column?: number
  row?: number
  segment?: 'right' | 'center' | 'left'
  rowMode?: 'justify' | 'right' | 'segments'
  layoutPadding?: Record<'right' | 'center' | 'left', { before: string[]; after: string[] }>
  breakAfter?: 'open' | 'closed'
  pageBreakBefore?: boolean
  layoutFragments?: SynchronizedLayoutFragment[]
}

export type SynchronizedLayoutRow = {
  page: number
  column: number
  row: number
  mode: 'justify' | 'right' | 'segments'
  layoutPadding?: Record<'right' | 'center' | 'left', { before: string[]; after: string[] }>
  breakAfter?: 'open' | 'closed'
  pageBreakBefore?: boolean
  segments: Record<'right' | 'center' | 'left', SynchronizedToken[]>
}

export function getActiveSynchronizedTokenIndex(tokens: SynchronizedToken[], time: number): number {
  const currentInterval = tokens.findIndex((token) => token.start <= time && time <= token.end)
  return currentInterval >= 0
    ? currentInterval
    : tokens.findLastIndex((token) => token.start <= time)
}

export function groupSynchronizedLayout(tokens: SynchronizedToken[]): SynchronizedLayoutRow[] {
  const rows = new Map<string, SynchronizedLayoutRow>()
  const inferredColumns = new Map<number, number>()
  const lastRowsByPage = new Map<number, number>()
  for (const originalToken of tokens) {
    const visualTokens = originalToken.layoutFragments?.map((fragment) => ({
      ...originalToken,
      ...fragment,
      layoutFragments: undefined,
    })) ?? [originalToken]
    for (const token of visualTokens) {
    if (token.page == null || token.row == null || !token.segment || !token.rowMode) continue
    let column = token.column
    if (column == null) {
      column = inferredColumns.get(token.page) ?? 0
      const previousRow = lastRowsByPage.get(token.page)
      if (previousRow != null && token.row < previousRow) column += 1
      inferredColumns.set(token.page, column)
      lastRowsByPage.set(token.page, token.row)
    }
    const key = `${token.page}:${column}:${token.row}`
    let row = rows.get(key)
    if (!row) {
      row = {
        page: token.page,
        column,
        row: token.row,
        mode: token.rowMode,
        segments: { right: [], center: [], left: [] },
      }
      rows.set(key, row)
    }
    row.segments[token.segment].push(token)
    if (token.layoutPadding) row.layoutPadding = token.layoutPadding
    if (token.breakAfter) row.breakAfter = token.breakAfter
    if (token.pageBreakBefore) row.pageBreakBefore = true
    }
  }
  return [...rows.values()]
    .map((row) => {
      for (const segment of Object.values(row.segments)) segment.sort((a, b) => a.index - b.index)
      return row
    })
    .sort((a, b) => a.page - b.page || a.column - b.column || a.row - b.row)
}
