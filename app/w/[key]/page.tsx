import { db } from "@/lib/db.ts";
import { ensureSeeded } from "@/lib/seed.ts";
import { liveWidget } from "@/lib/widget.ts";
import WidgetChat from "./WidgetChat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "Chat" };

// The chat inside the website widget (lib/widget.ts): shown in a frame on the bank's own pages by public/widget.js.
// Always the light theme, in the bank's colour; never Orchestra's name or logo.
export default async function WidgetPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  let w = null;
  if (process.env.DATABASE_URL) {
    const sql = db();
    await ensureSeeded(sql);
    w = await liveWidget(sql, key);
  }
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: "document.documentElement.dataset.theme='light'" }} />
      {w ? (
        <WidgetChat widgetKey={key} title={w.title} colour={w.colour} origins={w.origins} />
      ) : (
        <div className="wchat-off" role="status">This chat isn't available right now.</div>
      )}
    </>
  );
}
