import type { Metadata } from "next";
import Chat from "../components/Chat";

export const metadata: Metadata = {
  title: "Customer app · Orchestra AI prototype",
  description: "The customer's side of the prototype: a banking app's support chat. Simulated data only.",
};

// The customer's side: a banking app's support chat. The bank's side is the console at /.
export default function CustomerPage() {
  return <Chat />;
}
