import { headers } from 'next/headers';
import { EXPERIMENTS, decodeAssignments, type ExperimentId } from '@/lib/experiments';

/**
 * Server-side read of the edge-assigned experiment variant.
 *
 * Middleware sets `x-experiment` on every request that flowed through the
 * matcher. This helper reads it and falls back to the registered control
 * (first variant) if the header is missing — e.g. direct-to-Server-Component
 * render paths that bypassed middleware. That fallback keeps rendering
 * deterministic and prevents undefined variant values from reaching JSX.
 */
export async function getVariant(id: ExperimentId): Promise<string> {
  const requestHeaders = await headers();
  const assignments = decodeAssignments(
    requestHeaders.get('x-experiment') ?? undefined,
  );
  const exp = EXPERIMENTS[id];
  const assigned = assignments[id];
  if (assigned && exp.variants.includes(assigned)) {
    return assigned;
  }
  return exp.variants[0]!; // control
}
