import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Billing — Hodari',
  description: 'Manage your Hodari credits and subscription.',
}

export default function BillingLayout({ children }: { children: React.ReactNode }) {
  return children
}
