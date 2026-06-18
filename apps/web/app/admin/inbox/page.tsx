import { listConversations } from "@/lib/conversation";
import { Inbox } from "./Inbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const list = await listConversations(80);
  return <Inbox initial={list as never} />;
}
