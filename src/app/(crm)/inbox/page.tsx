import { InboxView } from "@/components/inbox/inbox-view";
import { requireAuth } from "@/lib/auth";
export const metadata = { title: "Inbox" };
export default async function Page() {
  const auth = await requireAuth();
  return <InboxView me={auth.userId} />;
}
