/**
 * lib/experiments.ts
 *
 * Experiment registry + assignment helpers — the shape production headless stacks run
 * via Optimizely: bucket users at the edge on first request, stamp a cookie,
 * then Server Components render the assigned variant on every subsequent
 * navigation with zero client-side flicker (no DOM swap after paint).
 *
 * The edge (middleware.ts) writes; the render (Server Components) reads.
 * Cookie shape is stable so ISR variants can still be cached per-bucket.
 */

export type ExperimentId = 'hero_headline' | 'join_cta';

export interface Experiment {
  id: ExperimentId;
  variants: readonly string[]; // first variant is the control
  weights: readonly number[];  // must sum to 1.0
}

// ─── Registry ────────────────────────────────────────────────────────────────
// Adding an experiment: append here + read via getVariant() in a Server
// Component. The middleware picks it up on the next request and starts
// bucketing traffic. No client-side wiring required.

export const EXPERIMENTS: Record<ExperimentId, Experiment> = {
  hero_headline: {
    id: 'hero_headline',
    variants: ['A', 'B'] as const,
    weights: [0.5, 0.5] as const,
  },
  join_cta: {
    id: 'join_cta',
    variants: ['control', 'urgency', 'value'] as const,
    weights: [0.34, 0.33, 0.33] as const,
  },
};

// ─── Cookie codec ────────────────────────────────────────────────────────────
// Compact form: exp1:variantA|exp2:variantB
// Chosen over JSON for a shorter cookie header (matters on cold Edge).

export const EXPERIMENT_COOKIE = 'exp';

export function encodeAssignments(assignments: Record<string, string>): string {
  return Object.entries(assignments)
    .map(([id, variant]) => `${id}:${variant}`)
    .join('|');
}

export function decodeAssignments(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  const out: Record<string, string> = {};
  for (const chunk of raw.split('|')) {
    const [id, variant] = chunk.split(':');
    if (id && variant) out[id] = variant;
  }
  return out;
}

// ─── Assignment logic ────────────────────────────────────────────────────────
// Weighted random bucket. Given a Math.random() draw in [0,1), pick the first
// variant whose cumulative weight crosses the draw. Exposed as a pure function
// so tests can inject a deterministic RNG.

export function pickVariant(exp: Experiment, draw: number): string {
  let cursor = 0;
  for (let i = 0; i < exp.variants.length; i++) {
    cursor += exp.weights[i]!;
    if (draw < cursor) return exp.variants[i]!;
  }
  return exp.variants[exp.variants.length - 1]!;
}

/**
 * For each experiment in the registry, ensure the incoming assignment map has
 * a variant assigned. Returns a NEW map — never mutates. The `assigned` return
 * flag signals whether any new buckets were rolled (so middleware knows to
 * refresh the cookie).
 */
export function ensureAssignments(
  existing: Record<string, string>,
  rng: () => number = Math.random,
): { assignments: Record<string, string>; assigned: boolean } {
  const out = { ...existing };
  let assigned = false;
  for (const exp of Object.values(EXPERIMENTS)) {
    if (!out[exp.id] || !exp.variants.includes(out[exp.id]!)) {
      out[exp.id] = pickVariant(exp, rng());
      assigned = true;
    }
  }
  return { assignments: out, assigned };
}
