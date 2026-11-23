import { redirect } from "next/navigation";

// The Staff queue was renamed Cases (Tomi, Nov 23): old links keep working.
export default async function StaffQueueMoved({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const c = (await searchParams).case;
  redirect(c ? `/cases?case=${encodeURIComponent(c)}` : "/cases");
}
