// contract-checks.js
//
// Generic contract-check engine.
//
// A contract has:
//   checks: mechanical checks
//   semantic_checks: LLM-evaluated checks
//
// runChecks() returns findings:
//   { check, severity, category, target, finding, fix }

type CheckResult = { target: string; finding: string; fix: string };

function labelFor(item: unknown, idx: number, field: string): string {
  if (item && typeof item === 'object') {
    const obj = item as Record<string, unknown>;
    if (obj.id) return obj.id as string;
    if (obj.name) return obj.name as string;
    if (obj.component) return obj.component as string;
    if (obj.path) return obj.path as string;
    if (obj.task_id) return obj.task_id as string;
  }

  return `${field}[${idx}]`;
}

function getTopArray(obj: Record<string, unknown>, field: string): unknown[] {
  const v = obj?.[field];
  return Array.isArray(v) ? v : [];
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : v === undefined || v === null ? [] : [v];
}

function conditionMatches(item: unknown, where: unknown): boolean {
  if (!where) return true;

  const conditions = Array.isArray(where) ? where : [where];

  return conditions.every((cond: unknown) => {
    if (!cond || typeof cond !== 'object') return true;

    const c = cond as Record<string, unknown>;
    const actual = c.field ? (item as Record<string, unknown>)?.[c.field as string] : item;
    const norm = (v: unknown) => (typeof v === 'string' ? v.toLowerCase() : v);

    if (c.exists !== undefined) {
      const exists = actual !== undefined && actual !== null && actual !== '';
      return exists === Boolean(c.exists);
    }

    if (c.equals !== undefined) {
      return asArray(c.equals).some((v: unknown) => norm(actual) === norm(v));
    }

    if (c.not_equals !== undefined) {
      return !asArray(c.not_equals).some((v: unknown) => norm(actual) === norm(v));
    }

    if (c.in !== undefined) {
      return asArray(c.in).some((v: unknown) => norm(actual) === norm(v));
    }

    if (c.not_in !== undefined) {
      return !asArray(c.not_in).some((v: unknown) => norm(actual) === norm(v));
    }

    return true;
  });
}

function normalizeFilePath(p: string): string {
  if (typeof p !== 'string') return '';

  return p
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .toLowerCase();
}

function resolvePath(obj: unknown, fieldPath: string) {
  const wildcardIdx = fieldPath.indexOf('[*]');

  if (wildcardIdx === -1) {
    const parts = fieldPath.split('.');
    let cur: unknown = obj;

    for (const p of parts) cur = (cur as Record<string, unknown>)?.[p];

    return { scalar: true, value: cur };
  }

  const arrayField = fieldPath.slice(0, wildcardIdx);
  let rest = fieldPath.slice(wildcardIdx + 3);

  if (rest.startsWith('.')) rest = rest.slice(1);

  const arr = arrayField
    ? getTopArray(obj as Record<string, unknown>, arrayField)
    : Array.isArray(obj)
      ? obj
      : [];

  const items = arr.map((item: unknown, idx: number) => {
    let value: unknown = item;

    if (rest) {
      for (const p of rest.split('.')) value = (value as Record<string, unknown>)?.[p];
    }

    return { item, idx, value };
  });

  return { scalar: false, arrayField, items };
}

function iteratePath(obj: Record<string, unknown>, fieldPath: string) {
  const resolved = resolvePath(obj, fieldPath);

  if (resolved.scalar) {
    return [{ item: undefined, idx: 0, value: resolved.value, scalar: true }];
  }

  return (resolved.items || []).map((entry) => ({
    ...entry,
    scalar: false,
  }));
}

function fill(template: string, vars: Record<string, unknown>): string {
  return String(template || '').replace(
    /{(\w+)}/g,
    (_, k: string) => (vars[k] !== undefined ? String(vars[k]) : `{${k}}`)
  );
}

function countSentences(text: unknown): number {
  if (!text || typeof text !== 'string') return 0;

  const trimmed = text.trim();
  if (!trimmed) return 0;

  return trimmed
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.trim().length > 0).length;
}

function arraySatisfiesNonEmpty(arr: unknown[], params?: Record<string, unknown>): boolean {
  if (!Array.isArray(arr) || arr.length === 0) return false;

  if (params?.sentinel !== undefined) {
    const count = arr.filter((x) => x === params.sentinel).length;

    if (count > 0) {
      return count === 1 && arr.length === 1;
    }
  }

  if (params?.sentinel_type !== undefined) {
    const count = arr.filter(
      (x: unknown) =>
        !!x &&
        typeof x === 'object' &&
        (x as Record<string, unknown>).type === params.sentinel_type
    ).length;

    if (count > 0) {
      return count === 1 && arr.length === 1;
    }
  }

  return true;
}

const handlers: Record<string, (artifact: unknown, check: Record<string, unknown>, contract?: Record<string, unknown>, ctx?: Record<string, unknown>) => CheckResult[]> = {
  id_format(artifact: unknown, check: Record<string, unknown>) {
    const out: CheckResult[] = [];
    const p = check.params as Record<string, unknown> | undefined;

    for (const { field, id_field, pattern } of (p?.arrays as { field: string; id_field: string; pattern: string }[] || [])) {
      const re = new RegExp(pattern);

      getTopArray(artifact as Record<string, unknown>, field).forEach((item: unknown, idx: number) => {
        const val = (item as Record<string, unknown>)?.[id_field as string];

        if (!val || !re.test(val as string)) {
          out.push({
            target: ((val as string) || labelFor(item, idx, field)) as string,
            finding: check.message as string,
            fix: check.fix as string,
          });
        }
      });
    }

    return out;
  },

  unique_id(artifact: unknown, check: Record<string, unknown>) {
    const out: CheckResult[] = [];
    const p = check.params as Record<string, unknown> | undefined;

    for (const { field, id_field } of (p?.arrays as { field: string; id_field: string }[] || [])) {
      const seen = new Map<string | number, number>();

      getTopArray(artifact as Record<string, unknown>, field).forEach((item: unknown, idx: number) => {
        const val = (item as Record<string, unknown>)?.[id_field as string];
        if (val == null) return;

        if (seen.has(val as string)) {
          out.push({
            target: String(val),
            finding: `${check.message as string} ('${val}' in ${field}, first seen at index ${seen.get(val as string)})`,
            fix: check.fix as string,
          });
        } else {
          seen.set(val as string, idx);
        }
      });
    }

    return out;
  },

  reference_integrity(artifact: unknown, check: Record<string, unknown>, contract?: Record<string, unknown>, ctx?: Record<string, unknown>) {
    const out: CheckResult[] = [];
    const p = check.params as Record<string, unknown> | undefined;

    let sourceObj: unknown = artifact;

    if (p?.optional_artifact) {
      const loaded = (ctx?.loadFile as Function)?.(p.optional_artifact as string);
      if (!loaded) return out;
      sourceObj = loaded;
    }

    const refObj = p?.ref_file
      ? (ctx?.loadFile as Function)?.(p.ref_file as string)
      : artifact;

    if (!refObj) return out;

    const refIds = new Set<unknown>();

    for (const arrName of (p?.ref_arrays as string[] || [])) {
      getTopArray(refObj as Record<string, unknown>, arrName).forEach((item: unknown) => {
        const id = (item as Record<string, unknown>)?.[p?.ref_id as string];
        if (id != null) refIds.add(id);
      });
    }

    for (const entry of iteratePath(sourceObj as Record<string, unknown>, p?.field as string)) {
      if (!entry.scalar && !conditionMatches(entry.item, p?.where)) {
        continue;
      }

      const refs: unknown[] = Array.isArray(entry.value)
        ? entry.value
        : entry.value != null
          ? [entry.value]
          : [];

      for (const ref of refs) {
        if (ref == null) continue;

        if (!refIds.has(ref)) {
          out.push({
            target: entry.scalar
              ? 'doc'
              : (entry.item as Record<string, unknown>)?.id as string ||
                (entry.item as Record<string, unknown>)?.task_id as string ||
                labelFor(entry.item, entry.idx, p?.field as string),
            finding: `${check.message as string}: ${ref}`,
            fix: check.fix as string,
          });
        }
      }
    }

    return out;
  },

  reverse_reference_integrity(artifact: unknown, check: Record<string, unknown>) {
    const out: CheckResult[] = [];
    const referenced = new Set<unknown>();
    const p = check.params as Record<string, unknown> | undefined;

    for (const arrName of (p?.ref_arrays as string[] || [])) {
      getTopArray(artifact as Record<string, unknown>, arrName).forEach((item: unknown) => {
        const v = (item as Record<string, unknown>)?.[p?.ref_field as string];
        const vals: unknown[] = Array.isArray(v) ? v : v != null ? [v] : [];
        vals.forEach((x: unknown) => referenced.add(x));
      });
    }

    for (const entry of iteratePath(artifact as Record<string, unknown>, p?.field as string)) {
      if (!entry.scalar && !conditionMatches(entry.item, p?.where)) {
        continue;
      }

      if (entry.value != null && !referenced.has(entry.value)) {
        out.push({
          target: entry.scalar
            ? 'doc'
            : (entry.item as Record<string, unknown>)?.id as string ||
              labelFor(entry.item, entry.idx, p?.field as string),
          finding: check.message as string,
          fix: check.fix as string,
        });
      }
    }

    return out;
  },

  array_nonempty(artifact: unknown, check: Record<string, unknown>, contract?: Record<string, unknown>, ctx?: Record<string, unknown>) {
    const p = check.params as Record<string, unknown> | undefined;
    let obj: unknown = artifact;

    if (p?.optional_artifact) {
      const loaded = (ctx?.loadFile as Function)?.(p.optional_artifact as string);
      if (!loaded) return [];
      obj = loaded;
    }

    if ((p?.field as string).includes('[*]')) {
      const out: CheckResult[] = [];

      for (const entry of iteratePath(obj as Record<string, unknown>, p?.field as string)) {
        if (!entry.scalar && !conditionMatches(entry.item, p?.where)) {
          continue;
        }

        const arr: unknown[] = Array.isArray(entry.value) ? entry.value : [];

        if (!arraySatisfiesNonEmpty(arr, p)) {
          out.push({
            target:
              (entry.item as Record<string, unknown>)?.id as string ||
              (entry.item as Record<string, unknown>)?.task_id as string ||
              labelFor(entry.item, entry.idx, p?.field as string),
            finding: check.message as string,
            fix: check.fix as string,
          });
        }
      }

      return out;
    }

    const arr = getTopArray(obj as Record<string, unknown>, p?.field as string);

    if (!arraySatisfiesNonEmpty(arr, p)) {
      return [{ target: 'doc', finding: check.message as string, fix: check.fix as string }];
    }

    return [];
  },

  min_entries(artifact: unknown, check: Record<string, unknown>) {
    const p = check.params as Record<string, unknown> | undefined;
    const arr = getTopArray(artifact as Record<string, unknown>, p?.field as string);

    if (arr.length < (p?.min as number)) {
      return [{ target: 'doc', finding: check.message as string, fix: check.fix as string }];
    }

    return [];
  },

  field_required(artifact: unknown, check: Record<string, unknown>) {
    const out: CheckResult[] = [];
    const p = check.params as Record<string, unknown> | undefined;

    const isMissing = (v: unknown): boolean => {
      if (v === undefined || v === null) return true;
      if (Array.isArray(v)) return !(p?.allow_empty as boolean) && v.length === 0;
      if (typeof v === 'string') return v.trim() === '';
      return false;
    };

    for (const entry of iteratePath(artifact as Record<string, unknown>, p?.field as string)) {
      if (!entry.scalar && !conditionMatches(entry.item, p?.where)) {
        continue;
      }

      if (isMissing(entry.value)) {
        out.push({
          target: entry.scalar
            ? 'doc'
            : (entry.item as Record<string, unknown>)?.id as string ||
              labelFor(entry.item, entry.idx, p?.field as string),
          finding: check.message as string,
          fix: check.fix as string,
        });
      }
    }

    return out;
  },

  assumption_fields(artifact: unknown, check: Record<string, unknown>) {
    const out: CheckResult[] = [];
    const p = check.params as Record<string, unknown> | undefined;
    const assumptions = getTopArray(artifact as Record<string, unknown>, 'assumptions');

    assumptions.forEach((item: unknown, idx: number) => {
      const label = labelFor(item, idx, 'assumptions');
      const obj = item as Record<string, unknown>;

      if (
        p?.require_types &&
        !(p.require_types as unknown[]).includes(obj.type)
      ) {
        out.push({ target: label, finding: check.message as string, fix: check.fix as string });
        return;
      }

      const requiredFields = (p?.variants as Record<string, unknown>)?.[obj.type as string];

      if (!requiredFields) {
        out.push({
          target: label,
          finding: `${check.message as string} (unknown assumption type: ${obj.type})`,
          fix: check.fix as string,
        });
        return;
      }

      for (const f of (requiredFields as string[])) {
        if (obj[f] === undefined || obj[f] === null || obj[f] === '') {
          out.push({
            target: label,
            finding: `${check.message as string} (missing '${f}')`,
            fix: check.fix as string,
          });
        }
      }
    });

    return out;
  },

  enum_value(artifact: unknown, check: Record<string, unknown>) {
    const out: CheckResult[] = [];
    const p = check.params as Record<string, unknown> | undefined;

    const cmp = (v: unknown) =>
      p?.case_insensitive && typeof v === 'string'
        ? v.toLowerCase()
        : v;

    const allowed = ((p?.allowed as unknown[]) || []).map(cmp);

    for (const entry of iteratePath(artifact as Record<string, unknown>, p?.field as string)) {
      if (!entry.scalar && !conditionMatches(entry.item, p?.where)) {
        continue;
      }

      if (entry.value != null && !allowed.includes(cmp(entry.value))) {
        out.push({
          target: entry.scalar
            ? 'doc'
            : (entry.item as Record<string, unknown>)?.id as string ||
              labelFor(entry.item, entry.idx, p?.field as string),
          finding: check.message as string,
          fix: check.fix as string,
        });
      }
    }

    return out;
  },

  enum_not_value(artifact: unknown, check: Record<string, unknown>) {
    const out: CheckResult[] = [];
    const p = check.params as Record<string, unknown> | undefined;

    const cmp = (v: unknown) =>
      p?.case_insensitive && typeof v === 'string'
        ? v.toLowerCase()
        : v;

    const forbidden = ((p?.forbidden as unknown[]) || []).map(cmp);

    for (const entry of iteratePath(artifact as Record<string, unknown>, p?.field as string)) {
      if (!entry.scalar && !conditionMatches(entry.item, p?.where)) {
        continue;
      }

      if (entry.value != null && forbidden.includes(cmp(entry.value))) {
        out.push({
          target: entry.scalar
            ? 'doc'
            : (entry.item as Record<string, unknown>)?.id as string ||
              labelFor(entry.item, entry.idx, p?.field as string),
          finding: check.message as string,
          fix: check.fix as string,
        });
      }
    }

    return out;
  },

  forbidden_words(artifact: unknown, check: Record<string, unknown>, contract?: Record<string, unknown>) {
    const out: CheckResult[] = [];
    const p = check.params as Record<string, unknown> | undefined;

    let words: unknown[] = (p?.words as unknown[]) || [];

    if (words.length === 0 && p?.words_from) {
      const key = (p.words_from as string).replace(/^rules\./, '');
      words = ((contract?.rules as Record<string, unknown>)?.[key] as unknown[]) || [];
    }

    if (words.length === 0) return out;

    const re = new RegExp(
      `\\b(${words
        .map((w: unknown) => String(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|')})\\b`,
      'i'
    );

    for (const entry of iteratePath(artifact as Record<string, unknown>, p?.field as string)) {
      if (!entry.scalar && !conditionMatches(entry.item, p?.where)) {
        continue;
      }

      if (typeof entry.value === 'string' && re.test(entry.value)) {
        out.push({
          target: entry.scalar
            ? 'doc'
            : (entry.item as Record<string, unknown>)?.id as string ||
              labelFor(entry.item, entry.idx, p?.field as string),
          finding: check.message as string,
          fix: check.fix as string,
        });
      }
    }

    return out;
  },

  given_when_then(artifact: unknown, check: Record<string, unknown>) {
    const out: CheckResult[] = [];
    const p = check.params as Record<string, unknown> | undefined;

    const keywords = ((p?.keywords as unknown[]) || []).map((kw: unknown) =>
      String(kw).toLowerCase()
    );

    for (const entry of iteratePath(artifact as Record<string, unknown>, p?.field as string)) {
      if (!entry.scalar && !conditionMatches(entry.item, p?.where)) {
        continue;
      }

      const text = String(entry.value || '').toLowerCase();
      const missing = keywords.some((kw: string) => !text.includes(kw));

      if (missing) {
        out.push({
          target: entry.scalar
            ? 'doc'
            : (entry.item as Record<string, unknown>)?.id as string ||
              labelFor(entry.item, entry.idx, p?.field as string),
          finding: check.message as string,
          fix: check.fix as string,
        });
      }
    }

    return out;
  },

  sentence_count(artifact: unknown, check: Record<string, unknown>) {
    const out: CheckResult[] = [];
    const p = check.params as Record<string, unknown> | undefined;

    for (const entry of iteratePath(artifact as Record<string, unknown>, p?.field as string)) {
      if (!entry.scalar && !conditionMatches(entry.item, p?.where)) {
        continue;
      }

      const n = countSentences(entry.value);

      if (n < (p?.min as number) || n > (p?.max as number)) {
        out.push({
          target: entry.scalar
            ? 'doc'
            : (entry.item as Record<string, unknown>)?.id as string ||
              labelFor(entry.item, entry.idx, p?.field as string),
          finding: check.message as string,
          fix: check.fix as string,
        });
      }
    }

    return out;
  },

  pattern_match(artifact: unknown, check: Record<string, unknown>) {
    const out: CheckResult[] = [];
    const p = check.params as Record<string, unknown> | undefined;
    const re = new RegExp(p?.pattern as string);

    for (const entry of iteratePath(artifact as Record<string, unknown>, p?.field as string)) {
      if (!entry.scalar && !conditionMatches(entry.item, p?.where)) {
        continue;
      }

      if (
        entry.value != null &&
        typeof entry.value === 'string' &&
        !re.test(entry.value)
      ) {
        out.push({
          target: entry.scalar
            ? 'doc'
            : (entry.item as Record<string, unknown>)?.id as string ||
              labelFor(entry.item, entry.idx, p?.field as string),
          finding: check.message as string,
          fix: check.fix as string,
        });
      }
    }

    return out;
  },

  at_least_one_of(artifact: unknown, check: Record<string, unknown>) {
    const p = check.params as Record<string, unknown> | undefined;
    const fields = (p?.fields as string[]) || [];
    const ok = fields.some((field: string) => getTopArray(artifact as Record<string, unknown>, field).length > 0);

    if (ok) return [];

    return [{ target: 'doc', finding: check.message as string, fix: check.fix as string }];
  },

  unique_values(artifact: unknown, check: Record<string, unknown>) {
    const out: CheckResult[] = [];
    const p = check.params as Record<string, unknown> | undefined;

    for (const entry of iteratePath(artifact as Record<string, unknown>, p?.field as string)) {
      if (!entry.scalar && !conditionMatches(entry.item, p?.where)) {
        continue;
      }

      if (!Array.isArray(entry.value)) continue;

      const seen = new Set<string>();

      for (const value of entry.value) {
        const key = String(value);

        if (seen.has(key)) {
          out.push({
            target:
              (entry.item as Record<string, unknown>)?.id as string ||
              labelFor(entry.item, entry.idx, p?.field as string),
            finding: `${check.message as string}: ${key}`,
            fix: check.fix as string,
          });
        }

        seen.add(key);
      }
    }

    return out;
  },

  version_match(artifact: unknown, check: Record<string, unknown>, contract?: Record<string, unknown>, ctx?: Record<string, unknown>) {
    const p = check.params as Record<string, unknown> | undefined;
    const refObj = (ctx?.loadFile as Function)?.(p?.ref_file as string);
    if (!refObj) return [];

    const localEntry = iteratePath(artifact as Record<string, unknown>, p?.local_field as string)[0];
    const refEntry = iteratePath(refObj as Record<string, unknown>, p?.ref_field as string)[0];

    if (localEntry?.value !== refEntry?.value) {
      return [
        {
          target: 'doc',
          finding: `${check.message as string} (${localEntry?.value} vs ${refEntry?.value})`,
          fix: check.fix as string,
        },
      ];
    }

    return [];
  },

  cross_file_traceability(artifact: unknown, check: Record<string, unknown>, contract?: Record<string, unknown>, ctx?: Record<string, unknown>) {
    const out: CheckResult[] = [];
    const p = check.params as Record<string, unknown> | undefined;

    const sourceData = (ctx?.loadFile as Function)?.(p?.source_file as string);
    if (!sourceData) return out;

    const sourceIds: unknown[] = [];

    for (const arrName of (p?.source_arrays as string[] || [])) {
      getTopArray(sourceData as Record<string, unknown>, arrName).forEach((item: unknown) => {
        const id = (item as Record<string, unknown>)?.[p?.source_id as string];
        if (id != null) sourceIds.push(id);
      });
    }

    const covered = new Set<unknown>();

    getTopArray(artifact as Record<string, unknown>, p?.target_array as string).forEach((item: unknown) => {
      const v = (item as Record<string, unknown>)?.[p?.target_field as string];
      const vals: unknown[] = Array.isArray(v) ? v : v != null ? [v] : [];
      vals.forEach((x: unknown) => covered.add(x));
    });

    for (const id of sourceIds) {
      if (!covered.has(id)) {
        out.push({ target: id as string, finding: check.message as string, fix: check.fix as string });
      }
    }

    return out;
  },

  graph_acyclic(artifact: unknown, check: Record<string, unknown>) {
    const out: CheckResult[] = [];
    const p = check.params as Record<string, unknown> | undefined;

    const tasks = getTopArray(artifact as Record<string, unknown>, p?.tasks_field as string).filter(
      (t: unknown) => (t as Record<string, unknown>)?.[p?.id_field as string] != null
    );

    const ids = new Set<unknown>(tasks.map((t: unknown) => (t as Record<string, unknown>)[p?.id_field as string]));
    const byId = new Map<unknown, unknown>(tasks.map((t: unknown) => [(t as Record<string, unknown>)[p?.id_field as string], t]));

    const tasksTyped = tasks as Record<string, unknown>[];
    const tf = p?.tasks_field as string;
    const idf = p?.id_field as string;
    const df = p?.depends_field as string;

    for (const t of tasksTyped) {
      for (const dep of (t[df] as unknown[]) || []) {
        if (!ids.has(dep)) {
          out.push({
            target: t[idf] as string,
            finding: `${check.message as string} (dangling dependency: ${dep})`,
            fix: check.fix as string,
          });
        }
      }
    }

    const WHITE = 0;
    const GRAY = 1;
    const BLACK = 2;

    const color = new Map<unknown, number>(tasksTyped.map((t) => [t[idf], WHITE]));
    const reported = new Set<string>();

    function visit(id: unknown, stack: unknown[]) {
      color.set(id, GRAY);
      stack.push(id);

      const t = byId.get(id) as Record<string, unknown> | undefined;

      for (const dep of (t?.[df] as unknown[]) || []) {
        if (!ids.has(dep)) continue;

        if (color.get(dep) === GRAY) {
          const cycleKey = [...stack.slice(stack.indexOf(dep)), dep]
            .sort()
            .join(',');

          if (!reported.has(cycleKey)) {
            reported.add(cycleKey);
            out.push({
              target: id as string,
              finding: `${check.message as string} (cycle involving ${dep})`,
              fix: check.fix as string,
            });
          }
        } else if (color.get(dep) === WHITE) {
          visit(dep, stack);
        }
      }

      stack.pop();
      color.set(id, BLACK);
    }

    for (const id of ids) {
      if (color.get(id) === WHITE) visit(id, []);
    }

    return out;
  },

  sequence_order(artifact: unknown, check: Record<string, unknown>) {
    const out: CheckResult[] = [];
    const p = check.params as Record<string, unknown> | undefined;
    const tasks = getTopArray(artifact as Record<string, unknown>, p?.tasks_field as string);

    let maxSeen = -1;
    let maxSeenVal: unknown = null;

    for (const t of tasks) {
      const tobj = t as Record<string, unknown>;
      const val = tobj[p?.order_field as string];
      const idx = ((p?.order as unknown[]) || []).indexOf(val);

      if (idx === -1) continue;

      if (idx < maxSeen) {
        out.push({
          target: (tobj.id as string) || (val as string),
          finding: fill(check.message as string, {
            val: val as string,
            prev: maxSeenVal as string,
            order: ((p?.order as unknown[]) || []).join(' → '),
          }),
          fix: check.fix as string,
        });
      } else {
        maxSeen = idx;
        maxSeenVal = val;
      }
    }

    return out;
  },

  test_coverage_adjacent(artifact: unknown, check: Record<string, unknown>) {
    const out: CheckResult[] = [];
    const p = check.params as Record<string, unknown> | undefined;
    const tasks = getTopArray(artifact as Record<string, unknown>, p?.tasks_field as string);

    for (const t of tasks) {
      const tobj = t as Record<string, unknown>;
      const typeField = p?.type_field as string;
      if (!(p?.producer_types as unknown[])?.includes(tobj[typeField])) {
        continue;
      }

      const hasConsumer = tasks.some(
        (o: unknown) => {
          const oobj = o as Record<string, unknown>;
          return oobj[typeField] === p?.consumer_type &&
            (oobj[p?.depends_field as string] as unknown[] || []).includes(
              tobj[p?.id_field as string]
            );
        }
      );

      if (!hasConsumer) {
        out.push({
          target: tobj[p?.id_field as string] as string,
          finding: fill(check.message as string, {
            id: tobj[p?.id_field as string] as string,
            type: tobj[typeField] as string,
          }),
          fix: check.fix as string,
        });
      }
    }

    return out;
  },

  file_op_order(artifact: unknown, check: Record<string, unknown>) {
    const out: CheckResult[] = [];
    const p = check.params as Record<string, unknown> | undefined;
    const tasks = getTopArray(artifact as Record<string, unknown>, p?.tasks_field as string);
    const created = new Set<string>();

    for (const t of tasks) {
      const tobj = t as Record<string, unknown>;
      for (const f of (tobj[p?.files_field as string] as unknown[]) || []) {
        const fobj = f as Record<string, unknown>;
        const pPath = normalizeFilePath(fobj?.[p?.path_field as string] as string);
        const op = fobj?.[p?.operation_field as string];

        if (!pPath) continue;

        if (op === p?.create_op) {
          created.add(pPath);
        } else if (!created.has(pPath)) {
          out.push({
            target: (tobj.id as string) || pPath,
            finding: fill(check.message as string, { op: op as string, path: pPath }),
            fix: check.fix as string,
          });
        }
      }
    }

    return out;
  },

  max_value(artifact: unknown, check: Record<string, unknown>) {
    const out: CheckResult[] = [];
    const p = check.params as Record<string, unknown> | undefined;

    for (const entry of iteratePath(artifact as Record<string, unknown>, p?.field as string)) {
      if (!entry.scalar && !conditionMatches(entry.item, p?.where)) {
        continue;
      }

      if (typeof entry.value === 'number' && entry.value > (p?.max as number)) {
        out.push({
          target: entry.scalar
            ? 'doc'
            : (entry.item as Record<string, unknown>)?.id as string ||
              labelFor(entry.item, entry.idx, p?.field as string),
          finding: fill(check.message as string, {
            value: entry.value,
            max: p?.max as number,
          }),
          fix: check.fix as string,
        });
      }
    }

    return out;
  },

  pattern_forbidden(artifact: unknown, check: Record<string, unknown>) {
    const out: CheckResult[] = [];
    const p = check.params as Record<string, unknown> | undefined;

    const patterns = ((p?.patterns as string[]) || []).map((patt: string) => new RegExp(patt));

    for (const entry of iteratePath(artifact as Record<string, unknown>, p?.field as string)) {
      if (!entry.scalar && !conditionMatches(entry.item, p?.where)) {
        continue;
      }

      const values: unknown[] = Array.isArray(entry.value)
        ? entry.value
        : [entry.value];

      for (const value of values) {
        if (typeof value !== 'string') continue;

        for (const re of patterns) {
          if (re.test(value)) {
            out.push({
              target: entry.scalar
                ? 'doc'
                : (entry.item as Record<string, unknown>)?.id as string ||
                  labelFor(entry.item, entry.idx, p?.field as string),
              finding: `${check.message as string}: "${value}"`,
              fix: check.fix as string,
            });
          }
        }
      }
    }

    return out;
  },

  file_exists(artifact: unknown, check: Record<string, unknown>, contract?: Record<string, unknown>, ctx?: Record<string, unknown>) {
    const out: CheckResult[] = [];
    const p = check.params as Record<string, unknown> | undefined;

    if (!(ctx?.fileExists as Function)) return out;

    const tasks = getTopArray(artifact as Record<string, unknown>, p?.tasks_field as string);

    for (const t of tasks) {
      const tobj = t as Record<string, unknown>;
      for (const f of (tobj[p?.files_field as string] as unknown[]) || []) {
        const fobj = f as Record<string, unknown>;
        const op = fobj?.[p?.operation_field as string];
        const pathVal = fobj?.[p?.path_field as string];

        if (!pathVal) continue;

        if (
          ((p?.require_existing_ops as unknown[]) || []).includes(op) &&
          !(ctx?.fileExists as Function)(pathVal as string)
        ) {
          out.push({
            target: tobj.id as string,
            finding: fill(check.message as string, { path: pathVal as string }),
            fix: check.fix as string,
          });
        }
      }
    }

    return out;
  },

  file_conflict_without_dependency(artifact: unknown, check: Record<string, unknown>) {
    const out: CheckResult[] = [];
    const p = check.params as Record<string, unknown> | undefined;

    const tasks = getTopArray(artifact as Record<string, unknown>, p?.tasks_field as string).filter(
      (t: unknown) => (t as Record<string, unknown>)?.[p?.id_field as string] != null
    );

    const adjacency = new Map<unknown, Set<unknown>>();

    const ensureNode = (id: unknown) => {
      if (!adjacency.has(id)) adjacency.set(id, new Set());
    };

    const addEdge = (a: unknown, b: unknown) => {
      if (a == null || b == null) return;

      ensureNode(a);
      ensureNode(b);

      adjacency.get(a)!.add(b);
      adjacency.get(b)!.add(a);
    };

    for (const t of tasks) {
      const tobj = t as Record<string, unknown>;
      const id = tobj[p?.id_field as string];
      ensureNode(id);

      for (const dep of (tobj[p?.depends_field as string] as unknown[]) || []) {
        addEdge(id, dep);
      }
    }

    const related = (a: unknown, b: unknown): boolean => {
      if (a === b) return true;

      const seen = new Set<unknown>([a]);
      const stack: unknown[] = [a];

      while (stack.length) {
        const cur = stack.pop();

        for (const n of adjacency.get(cur) || []) {
          if (n === b) return true;

          if (!seen.has(n)) {
            seen.add(n);
            stack.push(n);
          }
        }
      }

      return false;
    };

    const fileOwners = new Map<unknown, Set<string>>();

    for (const t of tasks) {
      const tobj = t as Record<string, unknown>;
      const id = tobj[p?.id_field as string];
      const files = (tobj[p?.files_field as string] as unknown[]) || [];

      if (!fileOwners.has(id)) fileOwners.set(id, new Set());

      for (const f of files) {
        const fPath = normalizeFilePath(
          typeof f === 'string' ? f : ((f as Record<string, unknown>)?.[p?.path_field as string] as string)
        );

        if (fPath) fileOwners.get(id)!.add(fPath);
      }
    }

    const ids = [...fileOwners.keys()];
    const reportedPairs = new Set<string>();

    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const a = ids[i];
        const b = ids[j];

        const filesA = fileOwners.get(a) || new Set<string>();
        const filesB = fileOwners.get(b) || new Set<string>();

        const overlap = [...filesA].filter((f: string) => f && filesB.has(f));

        if (overlap.length > 0 && !related(a, b)) {
          const pairKey = [a, b].sort().join('|');

          if (!reportedPairs.has(pairKey)) {
            reportedPairs.add(pairKey);

            out.push({
              target: `${a}, ${b}`,
              finding:
                `${check.message as string}: both touch ${overlap.join(', ')} ` +
                'with no declared dependency between them',
              fix: check.fix as string,
            });
          }
        }
      }
    }

    return out;
  },

  source_grep(artifact: unknown, check: Record<string, unknown>, contract?: Record<string, unknown>, ctx?: Record<string, unknown>) {
    const out: CheckResult[] = [];
    const p = check.params as Record<string, unknown> | undefined;

    if (typeof (ctx?.changedFiles as unknown) !== 'function') return out;
    if (typeof (ctx?.readFile as unknown) !== 'function') return out;

    const words: unknown[] = (p?.words as unknown[]) || [];
    if (words.length === 0) return out;

    const re = new RegExp(
      `(${words
        .map((w: unknown) => String(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|')})`,
      p?.case_insensitive ? 'i' : ''
    );

    const excludes = ((p?.exclude_patterns as string[]) || []).map(
      (patt: string) => new RegExp(patt)
    );

    const changedFiles = ctx?.changedFiles as unknown as () => string[];
    const readFile = ctx?.readFile as unknown as (path: string) => string | null;

    for (const relPath of changedFiles()) {
      if (excludes.some((exclude: RegExp) => exclude.test(relPath))) continue;

      const content = readFile(relPath);
      if (content == null) continue;

      content.split('\n').forEach((line: string, i: number) => {
        if (re.test(line)) {
          out.push({
            target: `${relPath}:${i + 1}`,
            finding: check.message as string,
            fix: check.fix as string,
          });
        }
      });
    }

    return out;
  },

  dependency_order(artifact: unknown, check: Record<string, unknown>) {
    const out: CheckResult[] = [];
    const p = check.params as Record<string, unknown> | undefined;

    const tasks = getTopArray(artifact as Record<string, unknown>, p?.tasks_field as string).filter(
      (t: unknown) => (t as Record<string, unknown>)?.[p?.id_field as string] != null
    );

    const idToIndex = new Map<unknown, number>(
      tasks.map((t: unknown, idx: number) => [(t as Record<string, unknown>)[p?.id_field as string], idx])
    );

    tasks.forEach((task: unknown, idx: number) => {
      const t = task as Record<string, unknown>;
      const id = t[p?.id_field as string];

      for (const dep of (t[p?.depends_field as string] as unknown[]) || []) {
        const depIdx = idToIndex.get(dep);

        if (depIdx === undefined) continue;

        if (depIdx > idx) {
          out.push({
            target: id as string,
            finding:
              `${check.message as string}: ${id} depends on ${dep}, ` +
              `but ${dep} appears later in the task list`,
            fix: check.fix as string,
          });
        }
      }
    });

    return out;
  },

  tasks_all_complete(artifact: unknown, check: Record<string, unknown>) {
    const out: CheckResult[] = [];
    const p = check.params as Record<string, unknown> | undefined;

    const tasks = getTopArray(artifact as Record<string, unknown>, p?.tasks_field as string);
    const completeStatuses = (p?.complete_statuses as unknown[]) || [];

    tasks.forEach((task: unknown, idx: number) => {
      const t = task as Record<string, unknown>;
      const id = (t?.[p?.id_field as string] as string) || labelFor(task, idx, p?.tasks_field as string);
      const status = t?.[p?.status_field as string];

      if (!completeStatuses.includes(status)) {
        out.push({
          target: id,
          finding: `${check.message as string}: ${id} has status '${(status as string) || 'missing'}'`,
          fix: check.fix as string,
        });
      }
    });

    return out;
  },

  execution_note_required(artifact: unknown, check: Record<string, unknown>) {
    const out: CheckResult[] = [];
    const p = check.params as Record<string, unknown> | undefined;

    const tasks = getTopArray(artifact as Record<string, unknown>, p?.tasks_field as string);
    const requireStatuses = (p?.require_statuses as unknown[]) || [];

    tasks.forEach((task: unknown, idx: number) => {
      const t = task as Record<string, unknown>;
      const id = (t?.[p?.id_field as string] as string) || labelFor(task, idx, p?.tasks_field as string);
      const status = t?.[p?.status_field as string];

      if (!requireStatuses.includes(status)) return;

      const note = t?.[p?.note_field as string];

      if (note === undefined || note === null || String(note).trim() === '') {
        out.push({
          target: id,
          finding: `${check.message as string}: ${id} has status '${status}' but no note`,
          fix: check.fix as string,
        });
      }
    });

    return out;
  },

  files_field_enum(artifact: unknown, check: Record<string, unknown>) {
    const out: CheckResult[] = [];
    const p = check.params as Record<string, unknown> | undefined;

    const tasks = getTopArray(artifact as Record<string, unknown>, p?.tasks_field as string);

    const cmp = (v: unknown) =>
      p?.case_insensitive && typeof v === 'string'
        ? v.toLowerCase()
        : v;

    const allowed = ((p?.allowed as unknown[]) || []).map(cmp);

    tasks.forEach((task: unknown, idx: number) => {
      const t = task as Record<string, unknown>;
      const id = (t?.[p?.id_field as string] as string) || labelFor(task, idx, p?.tasks_field as string);
      const files = (t?.[p?.files_field as string] as unknown[]) || [];

      files.forEach((file: unknown, fileIdx: number) => {
        const f = file as Record<string, unknown>;
        const value = f?.[p?.field as string];

        if (value == null) return;

        if (!allowed.includes(cmp(value))) {
          out.push({
            target: `${id} ${p?.files_field as string}[${fileIdx}]`,
            finding: `${check.message as string}: ${value}`,
            fix: check.fix as string,
          });
        }
      });
    });

    return out;
  },
};

const SEVERITIES = new Set(['blocking', 'major', 'minor', 'info']);

const CATEGORIES = new Set([
  'structural',
  'traceability',
  'completeness',
  'ambiguity',
  'security',
  'performance',
  'process',
  'quality',
]);

const REQUIRED_PARAMS: Record<string, string[]> = {
  id_format: ['arrays'],
  unique_id: ['arrays'],
  reference_integrity: ['field', 'ref_arrays', 'ref_id'],
  reverse_reference_integrity: ['field', 'ref_arrays', 'ref_field'],
  array_nonempty: ['field'],
  min_entries: ['field', 'min'],
  field_required: ['field'],
  assumption_fields: ['variants'],
  enum_value: ['field', 'allowed'],
  enum_not_value: ['field', 'forbidden'],
  forbidden_words: ['field'],
  given_when_then: ['field', 'keywords'],
  sentence_count: ['field', 'min', 'max'],
  pattern_match: ['field', 'pattern'],
  at_least_one_of: ['fields'],
  unique_values: ['field'],
  version_match: ['ref_file', 'local_field', 'ref_field'],
  cross_file_traceability: [
    'source_file',
    'source_arrays',
    'source_id',
    'target_array',
    'target_field',
  ],
  graph_acyclic: ['tasks_field', 'id_field', 'depends_field'],
  sequence_order: ['tasks_field', 'order_field', 'order'],
  test_coverage_adjacent: [
    'tasks_field',
    'type_field',
    'producer_types',
    'consumer_type',
    'depends_field',
    'id_field',
  ],
  file_op_order: [
    'tasks_field',
    'files_field',
    'path_field',
    'operation_field',
    'create_op',
  ],
  max_value: ['field', 'max'],
  pattern_forbidden: ['field', 'patterns'],
  file_exists: [
    'tasks_field',
    'files_field',
    'path_field',
    'operation_field',
    'require_existing_ops',
  ],
  file_conflict_without_dependency: [
    'tasks_field',
    'id_field',
    'depends_field',
    'files_field',
    'path_field',
  ],
  source_grep: ['words'],
  dependency_order: ['tasks_field', 'id_field', 'depends_field'],
  tasks_all_complete: ['tasks_field', 'status_field', 'complete_statuses'],
  execution_note_required: [
    'tasks_field',
    'status_field',
    'note_field',
    'require_statuses',
  ],
  files_field_enum: ['tasks_field', 'files_field', 'field', 'allowed'],
};

export function validateContract(contract: Record<string, unknown>): void {
  const problems: string[] = [];
  const seenIds = new Set<string>();

  const addChecks = (kind: string, checks: unknown) => {
    for (const check of (checks as Record<string, unknown>[]) || []) {
      const c = check as Record<string, unknown>;
      const label = c?.id
        ? `${kind} check '${c.id}'`
        : `${kind} check with missing id`;

      if (!c?.id) {
        problems.push(`${kind} check is missing id`);
      } else if (seenIds.has(c.id as string)) {
        problems.push(`duplicate check id: ${c.id}`);
      } else {
        seenIds.add(c.id as string);
      }

      if (!c?.severity) {
        problems.push(`${label} is missing severity`);
      } else if (!SEVERITIES.has(c.severity as string)) {
        problems.push(`${label} has invalid severity: ${c.severity}`);
      }

      if (!c?.category) {
        problems.push(`${label} is missing category`);
      } else if (!CATEGORIES.has(c.category as string)) {
        problems.push(`${label} has invalid category: ${c.category}`);
      }

      if (kind === 'mechanical') {
        if (!c?.type) {
          problems.push(`${label} is missing type`);
        } else if (!handlers[c.type as string]) {
          problems.push(`${label} has unknown type: ${c.type}`);
        } else if ((c.type as string) === 'forbidden_words') {
          const p = c.params as Record<string, unknown> | undefined;
          if (!p?.words && !p?.words_from) {
            problems.push(
              `${label} is missing params.words or params.words_from`
            );
          }
        } else {
          const required = REQUIRED_PARAMS[c.type as string] || [];
          const p = c.params as Record<string, unknown> | undefined;
          const missing = required.filter(
            (param: string) => p?.[param] === undefined
          );

          if (missing.length > 0) {
            problems.push(
              `${label} is missing required params: ${missing.join(', ')}`
            );
          }
        }
      }
    }
  };

  addChecks('mechanical', contract.checks);
  addChecks('semantic', contract.semantic_checks);

  if (problems.length > 0) {
    throw new Error(
      `Contract validation failed:\n - ${problems.join('\n - ')}`
    );
  }
}

export function runChecks(
  artifact: unknown,
  contract: Record<string, unknown>,
  ctx: Record<string, unknown> = {},
  opts: Record<string, unknown> = {}
): {
  check: string;
  severity: string;
  category: string;
  target: string;
  finding: string;
  fix: string;
}[] {
  validateContract(contract);

  const findings: {
    check: string;
    severity: string;
    category: string;
    target: string;
    finding: string;
    fix: string;
  }[] = [];
  const gate = opts.gate;

  for (const check of (contract.checks as Record<string, unknown>[]) || []) {
    const c = check as Record<string, unknown>;
    if (
      gate &&
      Array.isArray(c.gates) &&
      (c.gates as unknown[]).length > 0 &&
      !(c.gates as unknown[]).includes(gate)
    ) {
      continue;
    }

    const handler = handlers[c.type as string];

    if (!handler) {
      throw new Error(
        `Unknown check type: ${c.type as string} (check id: ${c.id as string})`
      );
    }

    let results: CheckResult[];

    try {
      results = handler(artifact, check, contract, ctx) as CheckResult[];
    } catch (err: unknown) {
      throw new Error(
        `Check '${c.id as string}' failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    for (const r of results || []) {
      findings.push({
        check: c.id as string,
        severity: c.severity as string,
        category: c.category as string,
        target: String((r as CheckResult).target ?? 'doc'),
        finding: (r as CheckResult).finding,
        fix: (r as CheckResult).fix,
      });
    }
  }

  return findings;
}
