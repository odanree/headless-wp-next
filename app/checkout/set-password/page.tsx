import type { Metadata } from 'next';
import { SetPasswordForm } from './SetPasswordForm';

export const metadata: Metadata = {
  title: 'Set Your Password',
  robots: { index: false },
};

type Props = {
  searchParams: { email?: string };
};

export default function SetPasswordPage({ searchParams }: Props) {
  const email = searchParams.email ?? '';
  return <SetPasswordForm email={email} />;
}
