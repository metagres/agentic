// contract-checks.mjs
//
// Generic contract-check engine.
//
// A contract has:
//   checks: mechanical checks
//   semantic_checks: LLM-evaluated checks
//
// runChecks() returns findings:
//   { check, severity, category, target, finding, fix }

function labelFor(item, idx, field) {
  if (item && typeof item === 'object') {
    if (item.id) return item.id;
    if (item.name) return item.name;
    if (item.component) return item.component;
    if (item.path) return item.path;
    if (item.task_id) return item.task_id;
  }

  return `${field}[${idx}]`;
}

function getTopArray(obj, field) {
  const v = obj?.[field];
  return Array.isArray(v) ? v : [];
}

function asArray(v) {
  return Array.isArray(v) ? v : v === undefined || v === null ? [] : [v];
}

function conditionMatches(item, where) {
  if (!where) return true;

  const conditions = Array.isArray(where) ? where : [where];

  return conditions.every((cond) => {
    if (!cond || typeof cond !== 'object') return true;

    const actual = cond.field ? item?.[cond.field] : item;
    const norm = (v) => (typeof v === 'string' ? v.toLowerCase() : v);

    if (cond.exists !== undefined) {
      const exists = actual !== undefined && actual !== null && actual !== '';
      return exists === Boolean(cond.exists);
    }

    if (cond.equals !== undefined) {
      return asArray(cond.equals).some((v) => norm(actual) === norm(v));
    }

    if (cond.not_equals !== undefined) {
      return !asArray(cond.not_equals).some((v) => norm(actual) === norm(v));
    }

    if (cond.in !== undefined) {
      return asArray(cond.in).some((v) => norm(actual) === norm(v));
    }

    if (cond.not_in !== undefined) {
      return !asArray(cond.not_in).some((v) => norm(actual) === norm(v));
    }

    return true;
  });
}

function normalizeFilePath(p) {
  if (typeof p !== 'string') return '';

  return p
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .toLowerCase();
}

function resolvePath(obj, fieldPath) {
  const wildcardIdx = fieldPath.indexOf('[*]');

  if (wildcardIdx === -1) {
    const parts = fieldPath.split('.');
    let cur = obj;

    for (const p of parts) cur = cur?.[p];

    return { scalar: true, value: cur };
  }

  const arrayField = fieldPath.slice(0, wildcardIdx);
  let rest = fieldPath.slice(wildcardIdx + 3);

  if (rest.startsWith('.')) rest = rest.slice(1);

  const arr = arrayField
    ? getTopArray(obj, arrayField)
    : Array.isArray(obj)
      ? obj
      : [];

  const items = arr.map((item, idx) => {
    let value = item;

    if (rest) {
      for (const p of rest.split('.')) value = value?.[p];
    }

    return { item, idx, value };
  });

  return { scalar: false, arrayField, items };
}

function iteratePath(obj, fieldPath) {
  const resolved = resolvePath(obj, fieldPath);

  if (resolved.scalar) {
    return [{ item: undefined, idx: 0, value: resolved.value, scalar: true }];
  }

  return (resolved.items || []).map((entry) => ({
    ...entry,
    scalar: false,
  }));
}

function fill(template, vars) {
  return String(template || '').replace(
    /{(\w+)}/g,
    (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`)
  );
}

function countSentences(text) {
  if (!text || typeof text !== 'string') return 0;

  const trimmed = text.trim();
  if (!trimmed) return 0;

  return trimmed
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.trim().length > 0).length;
}

function arraySatisfiesNonEmpty(arr, params) {
  if (!Array.isArray(arr) || arr.length === 0) return false;

  if (params?.sentinel !== undefined) {
    const count = arr.filter((x) => x === params.sentinel).length;

    if (count > 0) {
      return count === 1 && arr.length === 1;
    }
  }

  if (params?.sentinel_type !== undefined) {
    const count = arr.filter(
      (x) =>
        x &&
        typeof x === 'object' &&
        x.type === params.sentinel_type
    ).length;

    if (count > 0) {
      return count === 1 && arr.length === 1;
    }
  }

  return true;
}

const handlers = {
  id_format(artifact, check) {
    const out = [];

    for (const { field, id_field, pattern } of check.params.arrays) {
      const re = new RegExp(pattern);

      getTopArray(artifact, field).forEach((item, idx) => {
        const val = item?.[id_field];

        if (!val || !re.test(val)) {
          out.push({
            target: val || labelFor(item, idx, field),
            finding: check.message,
            fix: check.fix,
          });
        }
      });
    }

    return out;
  },

  unique_id(artifact, check) {
    const out = [];

    for (const { field, id_field } of check.params.arrays) {
      const seen = new Map();

      getTopArray(artifact, field).forEach((item, idx) => {
        const val = item?.[id_field];
        if (val == null) return;

        if (seen.has(val)) {
          out.push({
            target: String(val),
            finding: `${check.message} ('${val}' in ${field}, first seen at index ${seen.get(val)})`,
            fix: check.fix,
          });
        } else {
          seen.set(val, idx);
        }
      });
    }

    return out;
  },

  reference_integrity(artifact, check, contract, ctx) {
    const out = [];

    let sourceObj = artifact;

    if (check.params?.optional_artifact) {
      const loaded = ctx?.loadFile?.(check.params.optional_artifact);
      if (!loaded) return out;
      sourceObj = loaded;
    }

    const refObj = check.params?.ref_file
      ? ctx?.loadFile?.(check.params.ref_file)
      : artifact;

    if (!refObj) return out;

    const refIds = new Set();

    for (const arrName of check.params.ref_arrays || []) {
      getTopArray(refObj, arrName).forEach((item) => {
        const id = item?.[check.params.ref_id];
        if (id != null) refIds.add(id);
      });
    }

    for (const entry of iteratePath(sourceObj, check.params.field)) {
      if (!entry.scalar && !conditionMatches(entry.item, check.params?.where)) {
        continue;
      }

      const refs = Array.isArray(entry.value)
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
              : entry.item?.id ||
                entry.item?.task_id ||
                labelFor(entry.item, entry.idx, check.params.field),
            finding: `${check.message}: ${ref}`,
            fix: check.fix,
          });
        }
      }
    }

    return out;
  },

  reverse_reference_integrity(artifact, check) {
    const out = [];
    const referenced = new Set();

    for (const arrName of check.params.ref_arrays || []) {
      getTopArray(artifact, arrName).forEach((item) => {
        const v = item?.[check.params.ref_field];
        const vals = Array.isArray(v) ? v : v != null ? [v] : [];
        vals.forEach((x) => referenced.add(x));
      });
    }

    for (const entry of iteratePath(artifact, check.params.field)) {
      if (!entry.scalar && !conditionMatches(entry.item, check.params?.where)) {
        continue;
      }

      if (entry.value != null && !referenced.has(entry.value)) {
        out.push({
          target: entry.scalar
            ? 'doc'
            : entry.item?.id ||
              labelFor(entry.item, entry.idx, check.params.field),
          finding: check.message,
          fix: check.fix,
        });
      }
    }

    return out;
  },

  array_nonempty(artifact, check, contract, ctx) {
    let obj = artifact;

    if (check.params?.optional_artifact) {
      const loaded = ctx?.loadFile?.(check.params.optional_artifact);
      if (!loaded) return [];
      obj = loaded;
    }

    if (check.params.field.includes('[*]')) {
      const out = [];

      for (const entry of iteratePath(obj, check.params.field)) {
        if (!entry.scalar && !conditionMatches(entry.item, check.params?.where)) {
          continue;
        }

        const arr = Array.isArray(entry.value) ? entry.value : [];

        if (!arraySatisfiesNonEmpty(arr, check.params)) {
          out.push({
            target:
              entry.item?.id ||
              entry.item?.task_id ||
              labelFor(entry.item, entry.idx, check.params.field),
            finding: check.message,
            fix: check.fix,
          });
        }
      }

      return out;
    }

    const arr = getTopArray(obj, check.params.field);

    if (!arraySatisfiesNonEmpty(arr, check.params)) {
      return [{ target: 'doc', finding: check.message, fix: check.fix }];
    }

    return [];
  },

  min_entries(artifact, check) {
    const arr = getTopArray(artifact, check.params.field);

    if (arr.length < check.params.min) {
      return [{ target: 'doc', finding: check.message, fix: check.fix }];
    }

    return [];
  },

  field_required(artifact, check) {
    const out = [];

    const isMissing = (v) => {
      if (v === undefined || v === null) return true;
      if (Array.isArray(v)) return !check.params?.allow_empty && v.length === 0;
      if (typeof v === 'string') return v.trim() === '';
      return false;
    };

    for (const entry of iteratePath(artifact, check.params.field)) {
      if (!entry.scalar && !conditionMatches(entry.item, check.params?.where)) {
        continue;
      }

      if (isMissing(entry.value)) {
        out.push({
          target: entry.scalar
            ? 'doc'
            : entry.item?.id ||
              labelFor(entry.item, entry.idx, check.params.field),
          finding: check.message,
          fix: check.fix,
        });
      }
    }

    return out;
  },

  assumption_fields(artifact, check) {
    const out = [];
    const assumptions = getTopArray(artifact, 'assumptions');

    assumptions.forEach((item, idx) => {
      const label = labelFor(item, idx, 'assumptions');

      if (
        check.params?.require_types &&
        !check.params.require_types.includes(item.type)
      ) {
        out.push({ target: label, finding: check.message, fix: check.fix });
        return;
      }

      const requiredFields = check.params?.variants?.[item.type];

      if (!requiredFields) {
        out.push({
          target: label,
          finding: `${check.message} (unknown assumption type: ${item.type})`,
          fix: check.fix,
        });
        return;
      }

      for (const f of requiredFields) {
        if (item[f] === undefined || item[f] === null || item[f] === '') {
          out.push({
            target: label,
            finding: `${check.message} (missing '${f}')`,
            fix: check.fix,
          });
        }
      }
    });

    return out;
  },

  enum_value(artifact, check) {
    const out = [];

    const cmp = (v) =>
      check.params?.case_insensitive && typeof v === 'string'
        ? v.toLowerCase()
        : v;

    const allowed = (check.params.allowed || []).map(cmp);

    for (const entry of iteratePath(artifact, check.params.field)) {
      if (!entry.scalar && !conditionMatches(entry.item, check.params?.where)) {
        continue;
      }

      if (entry.value != null && !allowed.includes(cmp(entry.value))) {
        out.push({
          target: entry.scalar
            ? 'doc'
            : entry.item?.id ||
              labelFor(entry.item, entry.idx, check.params.field),
          finding: check.message,
          fix: check.fix,
        });
      }
    }

    return out;
  },

  enum_not_value(artifact, check) {
    const out = [];

    const cmp = (v) =>
      check.params?.case_insensitive && typeof v === 'string'
        ? v.toLowerCase()
        : v;

    const forbidden = (check.params.forbidden || []).map(cmp);

    for (const entry of iteratePath(artifact, check.params.field)) {
      if (!entry.scalar && !conditionMatches(entry.item, check.params?.where)) {
        continue;
      }

      if (entry.value != null && forbidden.includes(cmp(entry.value))) {
        out.push({
          target: entry.scalar
            ? 'doc'
            : entry.item?.id ||
              labelFor(entry.item, entry.idx, check.params.field),
          finding: check.message,
          fix: check.fix,
        });
      }
    }

    return out;
  },

  forbidden_words(artifact, check, contract) {
    const out = [];

    let words = check.params?.words || [];

    if (words.length === 0 && check.params?.words_from) {
      const key = check.params.words_from.replace(/^rules\./, '');
      words = contract?.rules?.[key] || [];
    }

    if (words.length === 0) return out;

    const re = new RegExp(
      `\\b(${words
        .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|')})\\b`,
      'i'
    );

    for (const entry of iteratePath(artifact, check.params.field)) {
      if (!entry.scalar && !conditionMatches(entry.item, check.params?.where)) {
        continue;
      }

      if (typeof entry.value === 'string' && re.test(entry.value)) {
        out.push({
          target: entry.scalar
            ? 'doc'
            : entry.item?.id ||
              labelFor(entry.item, entry.idx, check.params.field),
          finding: check.message,
          fix: check.fix,
        });
      }
    }

    return out;
  },

  given_when_then(artifact, check) {
    const out = [];

    const keywords = (check.params.keywords || []).map((kw) =>
      String(kw).toLowerCase()
    );

    for (const entry of iteratePath(artifact, check.params.field)) {
      if (!entry.scalar && !conditionMatches(entry.item, check.params?.where)) {
        continue;
      }

      const text = String(entry.value || '').toLowerCase();
      const missing = keywords.some((kw) => !text.includes(kw));

      if (missing) {
        out.push({
          target: entry.scalar
            ? 'doc'
            : entry.item?.id ||
              labelFor(entry.item, entry.idx, check.params.field),
          finding: check.message,
          fix: check.fix,
        });
      }
    }

    return out;
  },

  sentence_count(artifact, check) {
    const out = [];

    for (const entry of iteratePath(artifact, check.params.field)) {
      if (!entry.scalar && !conditionMatches(entry.item, check.params?.where)) {
        continue;
      }

      const n = countSentences(entry.value);

      if (n < check.params.min || n > check.params.max) {
        out.push({
          target: entry.scalar
            ? 'doc'
            : entry.item?.id ||
              labelFor(entry.item, entry.idx, check.params.field),
          finding: check.message,
          fix: check.fix,
        });
      }
    }

    return out;
  },

  pattern_match(artifact, check) {
    const out = [];
    const re = new RegExp(check.params.pattern);

    for (const entry of iteratePath(artifact, check.params.field)) {
      if (!entry.scalar && !conditionMatches(entry.item, check.params?.where)) {
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
            : entry.item?.id ||
              labelFor(entry.item, entry.idx, check.params.field),
          finding: check.message,
          fix: check.fix,
        });
      }
    }

    return out;
  },

  at_least_one_of(artifact, check) {
    const fields = check.params?.fields || [];
    const ok = fields.some((field) => getTopArray(artifact, field).length > 0);

    if (ok) return [];

    return [{ target: 'doc', finding: check.message, fix: check.fix }];
  },

  unique_values(artifact, check) {
    const out = [];

    for (const entry of iteratePath(artifact, check.params.field)) {
      if (!entry.scalar && !conditionMatches(entry.item, check.params?.where)) {
        continue;
      }

      if (!Array.isArray(entry.value)) continue;

      const seen = new Set();

      for (const value of entry.value) {
        const key = String(value);

        if (seen.has(key)) {
          out.push({
            target:
              entry.item?.id ||
              labelFor(entry.item, entry.idx, check.params.field),
            finding: `${check.message}: ${key}`,
            fix: check.fix,
          });
        }

        seen.add(key);
      }
    }

    return out;
  },

  version_match(artifact, check, contract, ctx) {
    const refObj = ctx?.loadFile?.(check.params.ref_file);
    if (!refObj) return [];

    const localEntry = iteratePath(artifact, check.params.local_field)[0];
    const refEntry = iteratePath(refObj, check.params.ref_field)[0];

    if (localEntry?.value !== refEntry?.value) {
      return [
        {
          target: 'doc',
          finding: `${check.message} (${localEntry?.value} vs ${refEntry?.value})`,
          fix: check.fix,
        },
      ];
    }

    return [];
  },

  cross_file_traceability(artifact, check, contract, ctx) {
    const out = [];

    const sourceData = ctx?.loadFile?.(check.params.source_file);
    if (!sourceData) return out;

    const sourceIds = [];

    for (const arrName of check.params.source_arrays || []) {
      getTopArray(sourceData, arrName).forEach((item) => {
        const id = item?.[check.params.source_id];
        if (id != null) sourceIds.push(id);
      });
    }

    const covered = new Set();

    getTopArray(artifact, check.params.target_array).forEach((item) => {
      const v = item?.[check.params.target_field];
      const vals = Array.isArray(v) ? v : v != null ? [v] : [];
      vals.forEach((x) => covered.add(x));
    });

    for (const id of sourceIds) {
      if (!covered.has(id)) {
        out.push({ target: id, finding: check.message, fix: check.fix });
      }
    }

    return out;
  },

  graph_acyclic(artifact, check) {
    const out = [];

    const tasks = getTopArray(artifact, check.params.tasks_field).filter(
      (t) => t?.[check.params.id_field] != null
    );

    const ids = new Set(tasks.map((t) => t[check.params.id_field]));
    const byId = new Map(tasks.map((t) => [t[check.params.id_field], t]));

    for (const t of tasks) {
      for (const dep of t[check.params.depends_field] || []) {
        if (!ids.has(dep)) {
          out.push({
            target: t[check.params.id_field],
            finding: `${check.message} (dangling dependency: ${dep})`,
            fix: check.fix,
          });
        }
      }
    }

    const WHITE = 0;
    const GRAY = 1;
    const BLACK = 2;

    const color = new Map(tasks.map((t) => [t[check.params.id_field], WHITE]));
    const reported = new Set();

    function visit(id, stack) {
      color.set(id, GRAY);
      stack.push(id);

      const t = byId.get(id);

      for (const dep of t?.[check.params.depends_field] || []) {
        if (!ids.has(dep)) continue;

        if (color.get(dep) === GRAY) {
          const cycleKey = [...stack.slice(stack.indexOf(dep)), dep]
            .sort()
            .join(',');

          if (!reported.has(cycleKey)) {
            reported.add(cycleKey);
            out.push({
              target: id,
              finding: `${check.message} (cycle involving ${dep})`,
              fix: check.fix,
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

  sequence_order(artifact, check) {
    const out = [];
    const tasks = getTopArray(artifact, check.params.tasks_field);

    let maxSeen = -1;
    let maxSeenVal = null;

    for (const t of tasks) {
      const val = t[check.params.order_field];
      const idx = check.params.order.indexOf(val);

      if (idx === -1) continue;

      if (idx < maxSeen) {
        out.push({
          target: t.id || val,
          finding: fill(check.message, {
            val,
            prev: maxSeenVal,
            order: check.params.order.join(' → '),
          }),
          fix: check.fix,
        });
      } else {
        maxSeen = idx;
        maxSeenVal = val;
      }
    }

    return out;
  },

  test_coverage_adjacent(artifact, check) {
    const out = [];
    const tasks = getTopArray(artifact, check.params.tasks_field);

    for (const t of tasks) {
      if (!check.params.producer_types.includes(t[check.params.type_field])) {
        continue;
      }

      const hasConsumer = tasks.some(
        (o) =>
          o[check.params.type_field] === check.params.consumer_type &&
          (o[check.params.depends_field] || []).includes(
            t[check.params.id_field]
          )
      );

      if (!hasConsumer) {
        out.push({
          target: t[check.params.id_field],
          finding: fill(check.message, {
            id: t[check.params.id_field],
            type: t[check.params.type_field],
          }),
          fix: check.fix,
        });
      }
    }

    return out;
  },

  file_op_order(artifact, check) {
    const out = [];
    const tasks = getTopArray(artifact, check.params.tasks_field);
    const created = new Set();

    for (const t of tasks) {
      for (const f of t[check.params.files_field] || []) {
        const p = normalizeFilePath(f?.[check.params.path_field]);
        const op = f?.[check.params.operation_field];

        if (!p) continue;

        if (op === check.params.create_op) {
          created.add(p);
        } else if (!created.has(p)) {
          out.push({
            target: t.id || p,
            finding: fill(check.message, { op, path: p }),
            fix: check.fix,
          });
        }
      }
    }

    return out;
  },

  max_value(artifact, check) {
    const out = [];

    for (const entry of iteratePath(artifact, check.params.field)) {
      if (!entry.scalar && !conditionMatches(entry.item, check.params?.where)) {
        continue;
      }

      if (typeof entry.value === 'number' && entry.value > check.params.max) {
        out.push({
          target: entry.scalar
            ? 'doc'
            : entry.item?.id ||
              labelFor(entry.item, entry.idx, check.params.field),
          finding: fill(check.message, {
            value: entry.value,
            max: check.params.max,
          }),
          fix: check.fix,
        });
      }
    }

    return out;
  },

  pattern_forbidden(artifact, check) {
    const out = [];

    const patterns = (check.params.patterns || []).map((p) => new RegExp(p));

    for (const entry of iteratePath(artifact, check.params.field)) {
      if (!entry.scalar && !conditionMatches(entry.item, check.params?.where)) {
        continue;
      }

      const values = Array.isArray(entry.value)
        ? entry.value
        : [entry.value];

      for (const value of values) {
        if (typeof value !== 'string') continue;

        for (const re of patterns) {
          if (re.test(value)) {
            out.push({
              target: entry.scalar
                ? 'doc'
                : entry.item?.id ||
                  labelFor(entry.item, entry.idx, check.params.field),
              finding: `${check.message}: "${value}"`,
              fix: check.fix,
            });
          }
        }
      }
    }

    return out;
  },

  file_exists(artifact, check, contract, ctx) {
    const out = [];

    if (!ctx?.fileExists) return out;

    const tasks = getTopArray(artifact, check.params.tasks_field);

    for (const t of tasks) {
      for (const f of t[check.params.files_field] || []) {
        const op = f?.[check.params.operation_field];
        const p = f?.[check.params.path_field];

        if (!p) continue;

        if (
          check.params.require_existing_ops.includes(op) &&
          !ctx.fileExists(p)
        ) {
          out.push({
            target: t.id,
            finding: fill(check.message, { path: p }),
            fix: check.fix,
          });
        }
      }
    }

    return out;
  },

  file_conflict_without_dependency(artifact, check) {
    const out = [];

    const tasks = getTopArray(artifact, check.params.tasks_field).filter(
      (t) => t?.[check.params.id_field] != null
    );

    const adjacency = new Map();

    const ensureNode = (id) => {
      if (!adjacency.has(id)) adjacency.set(id, new Set());
    };

    const addEdge = (a, b) => {
      if (a == null || b == null) return;

      ensureNode(a);
      ensureNode(b);

      adjacency.get(a).add(b);
      adjacency.get(b).add(a);
    };

    for (const t of tasks) {
      const id = t[check.params.id_field];
      ensureNode(id);

      for (const dep of t[check.params.depends_field] || []) {
        addEdge(id, dep);
      }
    }

    const related = (a, b) => {
      if (a === b) return true;

      const seen = new Set([a]);
      const stack = [a];

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

    const fileOwners = new Map();

    for (const t of tasks) {
      const id = t[check.params.id_field];
      const files = t[check.params.files_field] || [];

      if (!fileOwners.has(id)) fileOwners.set(id, new Set());

      for (const f of files) {
        const p = normalizeFilePath(
          typeof f === 'string' ? f : f?.[check.params.path_field]
        );

        if (p) fileOwners.get(id).add(p);
      }
    }

    const ids = [...fileOwners.keys()];
    const reportedPairs = new Set();

    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const a = ids[i];
        const b = ids[j];

        const filesA = fileOwners.get(a) || new Set();
        const filesB = fileOwners.get(b) || new Set();

        const overlap = [...filesA].filter((f) => f && filesB.has(f));

        if (overlap.length > 0 && !related(a, b)) {
          const pairKey = [a, b].sort().join('|');

          if (!reportedPairs.has(pairKey)) {
            reportedPairs.add(pairKey);

            out.push({
              target: `${a}, ${b}`,
              finding:
                `${check.message}: both touch ${overlap.join(', ')} ` +
                'with no declared dependency between them',
              fix: check.fix,
            });
          }
        }
      }
    }

    return out;
  },

  source_grep(artifact, check, contract, ctx) {
    const out = [];

    if (typeof ctx?.changedFiles !== 'function') return out;
    if (typeof ctx?.readFile !== 'function') return out;

    const words = check.params?.words || [];
    if (words.length === 0) return out;

    const re = new RegExp(
      `(${words
        .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|')})`,
      check.params?.case_insensitive ? 'i' : ''
    );

    const excludes = (check.params?.exclude_patterns || []).map(
      (p) => new RegExp(p)
    );

    for (const relPath of ctx.changedFiles()) {
      if (excludes.some((exclude) => exclude.test(relPath))) continue;

      const content = ctx.readFile(relPath);
      if (content == null) continue;

      content.split('\n').forEach((line, i) => {
        if (re.test(line)) {
          out.push({
            target: `${relPath}:${i + 1}`,
            finding: check.message,
            fix: check.fix,
          });
        }
      });
    }

    return out;
  },

  dependency_order(artifact, check) {
    const out = [];

    const tasks = getTopArray(artifact, check.params.tasks_field).filter(
      (t) => t?.[check.params.id_field] != null
    );

    const idToIndex = new Map(
      tasks.map((t, idx) => [t[check.params.id_field], idx])
    );

    tasks.forEach((task, idx) => {
      const id = task[check.params.id_field];

      for (const dep of task[check.params.depends_field] || []) {
        const depIdx = idToIndex.get(dep);

        if (depIdx === undefined) continue;

        if (depIdx > idx) {
          out.push({
            target: id,
            finding:
              `${check.message}: ${id} depends on ${dep}, ` +
              `but ${dep} appears later in the task list`,
            fix: check.fix,
          });
        }
      }
    });

    return out;
  },

  tasks_all_complete(artifact, check) {
    const out = [];

    const tasks = getTopArray(artifact, check.params.tasks_field);
    const completeStatuses = check.params.complete_statuses || [];

    tasks.forEach((task, idx) => {
      const id = task?.[check.params.id_field] || labelFor(task, idx, check.params.tasks_field);
      const status = task?.[check.params.status_field];

      if (!completeStatuses.includes(status)) {
        out.push({
          target: id,
          finding: `${check.message}: ${id} has status '${status || 'missing'}'`,
          fix: check.fix,
        });
      }
    });

    return out;
  },

  execution_note_required(artifact, check) {
    const out = [];

    const tasks = getTopArray(artifact, check.params.tasks_field);
    const requireStatuses = check.params.require_statuses || [];

    tasks.forEach((task, idx) => {
      const id = task?.[check.params.id_field] || labelFor(task, idx, check.params.tasks_field);
      const status = task?.[check.params.status_field];

      if (!requireStatuses.includes(status)) return;

      const note = task?.[check.params.note_field];

      if (note === undefined || note === null || String(note).trim() === '') {
        out.push({
          target: id,
          finding: `${check.message}: ${id} has status '${status}' but no note`,
          fix: check.fix,
        });
      }
    });

    return out;
  },

  files_field_enum(artifact, check) {
    const out = [];

    const tasks = getTopArray(artifact, check.params.tasks_field);

    const cmp = (v) =>
      check.params?.case_insensitive && typeof v === 'string'
        ? v.toLowerCase()
        : v;

    const allowed = (check.params.allowed || []).map(cmp);

    tasks.forEach((task, idx) => {
      const id = task?.[check.params.id_field] || labelFor(task, idx, check.params.tasks_field);
      const files = task?.[check.params.files_field] || [];

      files.forEach((file, fileIdx) => {
        const value = file?.[check.params.field];

        if (value == null) return;

        if (!allowed.includes(cmp(value))) {
          out.push({
            target: `${id} ${check.params.files_field}[${fileIdx}]`,
            finding: `${check.message}: ${value}`,
            fix: check.fix,
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

const REQUIRED_PARAMS = {
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

export function validateContract(contract) {
  const problems = [];
  const seenIds = new Set();

  const addChecks = (kind, checks) => {
    for (const check of checks || []) {
      const label = check?.id
        ? `${kind} check '${check.id}'`
        : `${kind} check with missing id`;

      if (!check?.id) {
        problems.push(`${kind} check is missing id`);
      } else if (seenIds.has(check.id)) {
        problems.push(`duplicate check id: ${check.id}`);
      } else {
        seenIds.add(check.id);
      }

      if (!check?.severity) {
        problems.push(`${label} is missing severity`);
      } else if (!SEVERITIES.has(check.severity)) {
        problems.push(`${label} has invalid severity: ${check.severity}`);
      }

      if (!check?.category) {
        problems.push(`${label} is missing category`);
      } else if (!CATEGORIES.has(check.category)) {
        problems.push(`${label} has invalid category: ${check.category}`);
      }

      if (kind === 'mechanical') {
        if (!check?.type) {
          problems.push(`${label} is missing type`);
        } else if (!handlers[check.type]) {
          problems.push(`${label} has unknown type: ${check.type}`);
        } else if (check.type === 'forbidden_words') {
          if (!check.params?.words && !check.params?.words_from) {
            problems.push(
              `${label} is missing params.words or params.words_from`
            );
          }
        } else {
          const required = REQUIRED_PARAMS[check.type] || [];
          const missing = required.filter(
            (p) => check.params?.[p] === undefined
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

export function runChecks(artifact, contract, ctx = {}, opts = {}) {
  validateContract(contract);

  const findings = [];
  const gate = opts?.gate;

  for (const check of contract.checks || []) {
    if (
      gate &&
      Array.isArray(check.gates) &&
      check.gates.length > 0 &&
      !check.gates.includes(gate)
    ) {
      continue;
    }

    const handler = handlers[check.type];

    if (!handler) {
      throw new Error(
        `Unknown check type: ${check.type} (check id: ${check.id})`
      );
    }

    let results;

    try {
      results = handler(artifact, check, contract, ctx);
    } catch (err) {
      throw new Error(`Check '${check.id}' failed: ${err.message}`);
    }

    for (const r of results || []) {
      findings.push({
        check: check.id,
        severity: check.severity,
        category: check.category,
        target: String(r.target ?? 'doc'),
        finding: r.finding,
        fix: r.fix,
      });
    }
  }

  return findings;
}
