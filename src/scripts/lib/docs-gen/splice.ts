/**
 * docs-gen splice engine: parses markdown documents into prose and
 * machine-generated segments delimited by docs-gen markers, and renders
 * segment lists back to deterministic document content.
 *
 * Marker grammar (whole lines, exact after trimming):
 *   <!-- docs-gen:begin id="<region-id>" -->
 *   <!-- docs-gen:end id="<region-id>" -->
 *
 * Regions never nest and ids are unique per document. Every deviation
 * (stray end marker, unclosed region, duplicate id, id mismatch) aborts
 * with a thrown Error naming the condition — the thrown-Error pattern
 * used across the check layer. All functions are pure: no I/O, no ambient
 * state, byte-identical output for identical input.
 */

const BEGIN_RE = /^<!--\s*docs-gen:begin\s+id="([^"]+)"\s*-->\s*$/;
const END_RE = /^<!--\s*docs-gen:end\s+id="([^"]+)"\s*-->\s*$/;

export function regionBeginMarker(id: string): string {
  return `<!-- docs-gen:begin id="${id}" -->`;
}

export function regionEndMarker(id: string): string {
  return `<!-- docs-gen:end id="${id}" -->`;
}

export interface DocSegment {
  kind: 'prose' | 'region';
  id: string | null;
  lines: string[];
}

export class DocsGenError extends Error {
  constructor(message: string) {
    super(`docs-gen: ${message}`);
    this.name = 'DocsGenError';
  }
}

/**
 * Parses document content into ordered segments. Prose segments carry the
 * marker-free lines; region segments carry their inner lines without the
 * marker lines. split('\n')/join('\n') round-trips content byte-for-byte,
 * so rendering unchanged segments reproduces the input exactly.
 */
export function parseSegments(content: string): DocSegment[] {
  const segments: DocSegment[] = [];
  let openId: string | null = null;
  let openLines: string[] = [];
  let proseLines: string[] = [];

  const flushProse = (): void => {
    if (proseLines.length > 0 || segments.length > 0) {
      segments.push({ kind: 'prose', id: null, lines: proseLines });
      proseLines = [];
    }
  };

  for (const line of content.split('\n')) {
    if (openId !== null) {
      const end = line.match(END_RE);
      if (end) {
        if (end[1] !== openId) {
          throw new DocsGenError(
            `region '${openId}' is closed by mismatched end marker '${end[1]}'`
          );
        }
        segments.push({ kind: 'region', id: openId, lines: openLines });
        openId = null;
        openLines = [];
        continue;
      }
      if (line.match(BEGIN_RE)) {
        throw new DocsGenError(`region '${openId}' is not closed before a new begin marker`);
      }
      openLines.push(line);
      continue;
    }

    const begin = line.match(BEGIN_RE);
    if (begin) {
      flushProse();
      openId = begin[1];
      continue;
    }
    const strayEnd = line.match(END_RE);
    if (strayEnd) {
      throw new DocsGenError(`end marker for region '${strayEnd[1]}' has no begin marker`);
    }
    proseLines.push(line);
  }

  if (openId !== null) {
    throw new DocsGenError(`region '${openId}' is never closed`);
  }
  flushProse();
  return segments;
}

export function regionIds(content: string): string[] {
  return parseSegments(content)
    .filter((segment) => segment.kind === 'region')
    .map((segment) => segment.id as string);
}

/**
 * Renders segments with region content replaced from `replacements`.
 * Region ids absent from the map keep their existing lines; ids present
 * in the map but not in the document are a stale-marker error.
 */
export function renderSegments(
  segments: DocSegment[],
  replacements: Map<string, string[]>
): string {
  for (const id of replacements.keys()) {
    if (!segments.some((segment) => segment.kind === 'region' && segment.id === id)) {
      throw new DocsGenError(
        `replacement targets region '${id}' which the document does not declare`
      );
    }
  }

  const lines: string[] = [];
  for (const segment of segments) {
    if (segment.kind === 'prose') {
      lines.push(...segment.lines);
      continue;
    }
    const id = segment.id as string;
    lines.push(regionBeginMarker(id));
    lines.push(...(replacements.get(id) ?? segment.lines));
    lines.push(regionEndMarker(id));
  }
  return lines.join('\n');
}

/** Renders one region replacement over the full document content. */
export function replaceRegion(content: string, id: string, nextLines: string[]): string {
  const replacements = new Map<string, string[]>([[id, nextLines]]);
  return renderSegments(parseSegments(content), replacements);
}

/**
 * Reads the preserved (agent-authored) lines of one region. Returns null
 * when the region is absent.
 */
export function readRegion(content: string, id: string): string[] | null {
  for (const segment of parseSegments(content)) {
    if (segment.kind === 'region' && segment.id === id) return segment.lines;
  }
  return null;
}

/** Requires every named region to be declared exactly once in the document. */
export function requireRegions(content: string, ids: string[]): void {
  const present = new Map<string, number>();
  for (const segment of parseSegments(content)) {
    if (segment.kind === 'region') {
      present.set(segment.id as string, (present.get(segment.id as string) ?? 0) + 1);
    }
  }
  for (const id of ids) {
    const count = present.get(id) ?? 0;
    if (count === 0) {
      throw new DocsGenError(`document does not declare required region '${id}'`);
    }
    if (count > 1) {
      throw new DocsGenError(`document declares region '${id}' ${count} times`);
    }
  }
}
