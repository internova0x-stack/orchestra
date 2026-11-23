import { redirect } from "next/navigation";

// The Cases screen became the console's Inbox, at the home page.
export default function CasesPage() {
  redirect("/");
}
