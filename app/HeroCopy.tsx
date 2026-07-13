import { getVariant } from '@/lib/getVariant';

/**
 * HeroCopy — Server Component that renders the assigned variant of the
 * hero_headline experiment. Bucketed at the edge (middleware.ts), rendered
 * on the server. No client hydration flicker, no DOM swap after paint.
 *
 * To evolve the copy: change the strings here. To retire the experiment:
 * remove the entry from EXPERIMENTS and inline whichever variant won.
 */
export default async function HeroCopy() {
  const variant = await getVariant('hero_headline');

  const headline = variant === 'B'
    ? 'Long-form technical writing. Delivered fresh at the edge.'
    : 'Member Articles';

  const sub = variant === 'B'
    ? 'Deep dives into headless CMS architecture, edge auth, ISR, and origin caching. Preview any abstract free — full access unlocks the details.'
    : 'Deep dives into headless CMS architecture, edge authentication, ISR, and more. Preview titles and abstracts — full access requires membership.';

  return (
    <div className="mb-10" data-experiment={`hero_headline:${variant}`}>
      <h1 className="text-3xl font-extrabold text-gray-900 mb-2">{headline}</h1>
      <p className="text-base text-gray-500 max-w-2xl whitespace-pre-line">{sub}</p>
    </div>
  );
}
