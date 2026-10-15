import type { Metadata } from "next";
import Link from "next/link";
import { accountByInviteToken } from "@/lib/developer/accounts";
import { InviteClient } from "./InviteClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Accept invitation" };

type Props = { params: Promise<{ token: string }> };

/**
 * Accepting an invitation: the token in the link names the account; the
 * developer sets a password and is signed in. A token that is spent, expired
 * or made up finds no account, and the page says so without guessing who it
 * might have been for.
 */
export default async function InvitePage({ params }: Props) {
  const { token } = await params;
  const account = await accountByInviteToken(token);
  if (!account) return <InvalidInvite />;
  return <InviteClient token={token} email={account.email} name={account.name} organization={account.organization} />;
}

function InvalidInvite() {
  return (
    <div className="mx-auto w-full max-w-[460px] py-10">
      <h1 className="text-[22px] font-semibold text-ink">This invitation is not valid</h1>
      <p className="mt-3 text-[14px] leading-relaxed text-ink-2">
        The link has expired, has already been used, or is not complete. Invitations work once and for seven days.
      </p>
      <p className="mt-3 text-[14px] leading-relaxed text-ink-2">Ask your 7X contact to send a new one. If you have already set a password, sign in instead.</p>
      <div className="mt-6">
        <Link
          href="/developers/login"
          className="inline-flex h-[38px] items-center rounded-lg border border-[var(--color-line)] bg-surface px-3.5 text-[13.5px] font-semibold text-ink-2  hover:bg-[var(--color-canvas)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--color-ring)]"
        >
          Go to sign in
        </Link>
      </div>
    </div>
  );
}
