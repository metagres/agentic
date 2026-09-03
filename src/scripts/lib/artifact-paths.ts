// Artifact path resolver (CMP-001, DEC-001, DM-002).
//
// Grammar: segment([].segment)* over dot-separated names. A segment followed
// by [] iterates the array-valued property it names across every current item;
// a spec without [] addresses a top-level node. The final segment addresses
// either an array (collection selectors) or a string scalar (leaf selectors).
//
// A spec traversing an absent property or an empty array yields an empty
// collection and never an error; schema validation, not this module, guards
// the required shape. Single-segment specs collapse to the getTopArray and
// resolvePath behavior in checks/shared.ts with identical target strings.
//
// The module performs no I/O and holds no ambient state: identical inputs
// produce identical outputs on every call.

/** One array instance a collection selector addresses, with its location. */
export interface ResolvedCollection {
  /** The items of the addressed array, in document order. */
  items: Record<string, unknown>[];
  /** Fully indexed location of the array, for example
   *  functional_requirements[0].acceptance_criteria. A top-level array keeps
   *  its plain property name as the location. */
  location: string;
}

/** One scalar string value a leaf selector addresses, with its target. */
export interface ResolvedLeaf {
  value: string;
  /** Fully indexed target, for example
   *  functional_requirements[0].acceptance_criteria[1].statement. */
  target: string;
}

export interface PathSegment {
  name: string;
  /** True when the segment is followed by [] and iterates the array-valued
   *  property it names. */
  iterate: boolean;
}

function readProperty(node: unknown, name: string): unknown {
  if (node === null || typeof node !== 'object') return undefined;
  return (node as Record<string, unknown>)[name];
}

// Parse a spec into segments. A spec without any [] marker is one literal
// segment (matching the top-level key lookups of getTopArray and resolvePath,
// including keys that themselves contain dots). Otherwise the spec splits on
// dots and a trailing [] marks the segment as an array iteration step.
// Exported so declaration path validation (CMP-003) shares the single grammar
// definition with resolution.
export function parsePathSpec(spec: string): PathSegment[] {
  if (!spec.includes('[]')) {
    return [{ name: spec, iterate: false }];
  }

  const segments: PathSegment[] = [];

  for (const piece of spec.split('.')) {
    if (piece.endsWith('[]')) {
      segments.push({ name: piece.slice(0, -2), iterate: true });
    } else {
      segments.push({ name: piece, iterate: false });
    }
  }

  return segments;
}

interface Cursor {
  node: unknown;
  location: string;
}

// Walk the traversal segments (all but the final one), carrying every current
// node with its indexed location. An iterate segment flattens the array-valued
// property it names across every current item; a plain segment descends into
// an object-valued property. Absent properties, empty arrays, and non-matching
// shapes contribute nothing and never error.
function walkTraversal(doc: Record<string, unknown>, segments: PathSegment[]): Cursor[] {
  let currents: Cursor[] = [{ node: doc, location: '' }];

  for (const segment of segments.slice(0, -1)) {
    const next: Cursor[] = [];

    for (const current of currents) {
      const value = readProperty(current.node, segment.name);

      if (segment.iterate) {
        if (Array.isArray(value)) {
          value.forEach((item, index) => {
            next.push({
              node: item,
              location: `${current.location}${segment.name}[${index}].`,
            });
          });
        }
      } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        next.push({ node: value, location: `${current.location}${segment.name}.` });
      }
    }

    currents = next;
  }

  return currents;
}

// resolveCollections(doc, spec): every non-empty array instance the spec
// addresses, together with its location chain. An absent property, an empty
// array, and a non-array shape all resolve to no collection, matching
// getTopArray's collapse of those cases to [] for single-segment specs.
export function resolveCollections(
  doc: Record<string, unknown>,
  spec: string
): ResolvedCollection[] {
  const segments = parsePathSpec(spec);
  if (segments.length === 0) return [];

  const finalSegment = segments[segments.length - 1];
  const out: ResolvedCollection[] = [];

  for (const current of walkTraversal(doc, segments)) {
    const value = readProperty(current.node, finalSegment.name);
    if (Array.isArray(value) && value.length > 0) {
      out.push({
        items: value as Record<string, unknown>[],
        location: `${current.location}${finalSegment.name}`,
      });
    }
  }

  return out;
}

// resolveLeafValues(doc, spec): the scalar string values the spec addresses,
// with fully indexed targets. A single-segment spec addresses a top-level
// string property, matching resolvePath; a two-segment spec matches its
// arrayField[i].itemField targets byte-identically.
export function resolveLeafValues(
  doc: Record<string, unknown>,
  spec: string
): ResolvedLeaf[] {
  const segments = parsePathSpec(spec);
  if (segments.length === 0) return [];

  const finalSegment = segments[segments.length - 1];
  const out: ResolvedLeaf[] = [];

  for (const current of walkTraversal(doc, segments)) {
    const value = readProperty(current.node, finalSegment.name);
    if (typeof value === 'string') {
      out.push({ value, target: `${current.location}${finalSegment.name}` });
    }
  }

  return out;
}
