import type { Metadata } from 'next';
import { JoinForm } from './JoinForm';

export const metadata: Metadata = {
  title: 'Sign In',
};

type Props = {
  searchParams: { redirectBack?: string };
};

/**
 * Server Component — reads redirectBack from URL props, passes it to the
 * Client Component form. No useSearchParams() / Suspense boundary needed.
 */
export default function JoinPage({ searchParams }: Props) {
  const redirectBack = searchParams.redirectBack ?? '/members';
  return <JoinForm redirectBack={redirectBack} />;
}