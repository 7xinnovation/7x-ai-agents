import { userByInviteToken } from "@/lib/users";
import { AcceptInvite } from "./AcceptInvite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Accepting an invitation to the console.
 *
 * Reached with no session — the whole point is that the person does not have an
 * account yet — so the token in the URL is what stands in for one. It is checked
 * here before anything is rendered: a spent or expired link is told so plainly
 * rather than being given a form that cannot work.
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await userByInviteToken(token);
  return <AcceptInvite token={token} name={user?.name ?? null} email={user?.email ?? null} valid={Boolean(user)} />;
}
