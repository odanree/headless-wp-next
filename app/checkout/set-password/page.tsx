import type { Metadata } from 'next';
import { SetPasswordForm } from './SetPasswordForm';

export const metadata: Metadata = {
  title: 'Set Your Password',
  robots: { index: false },
};

type Props = {
  searchParams: Promise<{ email?: string }>;
};

export default async function SetPasswordPage({ searchParams }: Props) {
  const { email = '' } = await searchParams;
  return <SetPasswordForm email={email} />;
}
