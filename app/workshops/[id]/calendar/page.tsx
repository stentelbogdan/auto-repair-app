import { redirect } from "next/navigation";

// Preserve old links without maintaining a second, static availability calendar.
export default async function WorkshopRequestCalendarPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/customer/schedule-damage/${encodeURIComponent(id)}?from=workshop&mode=initial-offer`);
}
