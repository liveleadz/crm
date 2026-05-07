// Lead detail entry point. We don't render a separate per-lead page —
// the lead profile lives inside `LeadDetailDrawer`, which slides over
// the leads list. So when anything in the app links to `/leads/{id}`
// (call popup, Live Floor active call, task item, calls list, team
// page, automations, inbound notification link_url, etc.) we redirect
// to `/leads?lead={id}` and the leads-table opens the drawer for that
// lead automatically.
//
// Without this redirect, every "open lead" link in the app 404s.

import { redirect } from 'next/navigation';

export default async function LeadByIdPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/leads?lead=${encodeURIComponent(id)}`);
}
