export const MAX_TERMINAL_SEARCH_MATCHES = 2000;

export interface TerminalSearchOptions {
  readonly caseSensitive: boolean;
  readonly regex: boolean;
}

export interface TerminalSearchRows {
  readonly texts: readonly string[];
  readonly wraps: readonly boolean[];
}

export interface TerminalSearchPosition {
  readonly row: number;
  readonly offset: number;
}

export interface TerminalSearchMatch {
  readonly start: TerminalSearchPosition;
  readonly end: TerminalSearchPosition;
}

export interface TerminalSearchResult {
  readonly matches: readonly TerminalSearchMatch[];
  readonly truncated: boolean;
  readonly error: string | null;
}

export interface TerminalSearchHighlight {
  readonly row: number;
  readonly startColumn: number;
  readonly endColumn: number;
  readonly active: boolean;
}

export interface TerminalSearchCellRow {
  readonly cells: readonly { readonly text: string; readonly wide: number }[];
}

function logicalLines(rows: TerminalSearchRows): { text: string; startRow: number }[] {
  const lines: { text: string; startRow: number }[] = [];
  const rowCount = Math.max(rows.texts.length, rows.wraps.length);
  let text = "";
  let startRow = 0;
  for (let row = 0; row < rowCount; row += 1) {
    text += rows.texts[row] ?? "";
    if (rows.wraps[row] === true && row < rowCount - 1) continue;
    const trimmedText = text.trimEnd();
    if (trimmedText.length > 0) lines.push({ text: trimmedText, startRow });
    text = "";
    startRow = row + 1;
  }
  return lines;
}

function searchPattern(query: string, options: TerminalSearchOptions): RegExp {
  const source = options.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(source, options.caseSensitive ? "g" : "gi");
}

function positionForOffset(
  texts: readonly string[],
  startRow: number,
  offset: number,
): TerminalSearchPosition | null {
  let consumedCharacters = 0;
  for (let row = startRow; row < texts.length; row += 1) {
    const rowLength = (texts[row] ?? "").length;
    if (offset < consumedCharacters + rowLength)
      return { row, offset: offset - consumedCharacters };
    consumedCharacters += rowLength;
  }
  return null;
}

/** Finds literal or regular-expression matches across terminal soft wraps. */
export function findTerminalSearchMatches(
  rows: TerminalSearchRows,
  query: string,
  options: TerminalSearchOptions,
): TerminalSearchResult {
  if (query.length === 0) return { matches: [], truncated: false, error: null };
  let pattern: RegExp;
  try {
    pattern = searchPattern(query, options);
  } catch {
    return { matches: [], truncated: false, error: "Invalid regular expression" };
  }
  const matches: TerminalSearchMatch[] = [];
  for (const line of logicalLines(rows)) {
    pattern.lastIndex = 0;
    for (let match = pattern.exec(line.text); match !== null; match = pattern.exec(line.text)) {
      if (match[0].length === 0) {
        pattern.lastIndex = match.index + 1;
        continue;
      }
      const start = positionForOffset(rows.texts, line.startRow, match.index);
      const inclusiveEnd = positionForOffset(
        rows.texts,
        line.startRow,
        match.index + match[0].length - 1,
      );
      if (start === null || inclusiveEnd === null) continue;
      if (matches.length === MAX_TERMINAL_SEARCH_MATCHES)
        return { matches, truncated: true, error: null };
      matches.push({ start, end: { row: inclusiveEnd.row, offset: inclusiveEnd.offset + 1 } });
    }
  }
  return { matches, truncated: false, error: null };
}

function columnForOffset(
  cells: readonly { readonly text: string; readonly wide: number }[],
  offset: number,
): number {
  let consumedCharacters = 0;
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index]!;
    const cellLength = cell.wide === 2 ? 0 : (cell.text || " ").length;
    if (consumedCharacters + cellLength > offset) return index;
    consumedCharacters += cellLength;
  }
  return Math.max(0, cells.length - 1);
}

/** Maps search matches to visible terminal-cell highlight ranges. */
export function terminalSearchHighlights(
  matches: readonly TerminalSearchMatch[],
  activeIndex: number,
  viewportTop: number,
  viewportRows: readonly TerminalSearchCellRow[],
): TerminalSearchHighlight[] {
  const highlights: TerminalSearchHighlight[] = [];
  const viewportBottom = viewportTop + viewportRows.length;
  let firstVisibleIndex = 0;
  let searchEnd = matches.length;
  while (firstVisibleIndex < searchEnd) {
    const middleIndex = Math.floor((firstVisibleIndex + searchEnd) / 2);
    if (matches[middleIndex]!.end.row < viewportTop) firstVisibleIndex = middleIndex + 1;
    else searchEnd = middleIndex;
  }
  for (let index = firstVisibleIndex; index < matches.length; index += 1) {
    const match = matches[index]!;
    if (match.start.row >= viewportBottom) break;
    const firstRow = Math.max(match.start.row, viewportTop);
    const lastRow = Math.min(match.end.row, viewportBottom - 1);
    for (let row = firstRow; row <= lastRow; row += 1) {
      const viewportRow = row - viewportTop;
      const cells = viewportRows[viewportRow]?.cells;
      if (cells === undefined) continue;
      const startColumn = row === match.start.row ? columnForOffset(cells, match.start.offset) : 0;
      let endColumn =
        row === match.end.row
          ? Math.max(0, columnForOffset(cells, match.end.offset - 1))
          : Math.max(0, cells.length - 1);
      if (endColumn + 1 < cells.length && cells[endColumn + 1]!.wide === 2) endColumn += 1;
      highlights.push({ row: viewportRow, startColumn, endColumn, active: index === activeIndex });
    }
  }
  return highlights;
}

/** Chooses the last match above the viewport bottom, or the first match. */
export function initialTerminalSearchIndex(
  matches: readonly TerminalSearchMatch[],
  viewportTop: number,
  viewportRowCount: number,
): number {
  if (matches.length === 0) return -1;
  const viewportBottom = viewportTop + viewportRowCount;
  const lastIndex = matches.findLastIndex((match) => match.start.row < viewportBottom);
  return lastIndex === -1 ? 0 : lastIndex;
}

/** Moves the active match index with wraparound in either direction. */
export function stepTerminalSearchIndex(current: number, count: number, direction: 1 | -1): number {
  if (count === 0) return -1;
  if (current === -1) return direction === 1 ? 0 : count - 1;
  const next = current + direction;
  return next < 0 ? count - 1 : next >= count ? 0 : next;
}

/** Finds the closest match at or after a previously active match. */
export function closestTerminalSearchIndex(
  matches: readonly TerminalSearchMatch[],
  previous: TerminalSearchMatch | null,
): number {
  if (matches.length === 0 || previous === null) return -1;
  const previousStart = previous.start;
  const index = matches.findIndex(
    (match) =>
      match.start.row > previousStart.row ||
      (match.start.row === previousStart.row && match.start.offset >= previousStart.offset),
  );
  return index === -1 ? matches.length - 1 : index;
}

/** Returns the scrollbar delta needed to reveal and center a match. */
export function terminalSearchScrollDelta(
  match: TerminalSearchMatch,
  scrollbar: { readonly total: number; readonly offset: number; readonly len: number },
): number {
  if (match.start.row >= scrollbar.offset && match.end.row < scrollbar.offset + scrollbar.len)
    return 0;
  const centeredOffset = match.start.row - Math.floor((scrollbar.len - 1) / 2);
  return Math.max(0, Math.min(centeredOffset, scrollbar.total - scrollbar.len)) - scrollbar.offset;
}
