import Link from "next/link";
import { currentDeveloper } from "@/lib/developer/session";
import { Mark } from "./Mark";
import { SignOutButton } from "./SignOutButton";
import { DevNav } from "./DevNav";

/**
 * The portal's header: the mark, the sections, and who is signed in. A server
 * component, so the account comes from the cookie without a round trip; the
 * nav highlights itself on the client.
 */
export async function DevHeader() {
  const dev = await currentDeveloper();
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--color-line)] bg-white/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-6 px-4 sm:px-6">
        <Link href="/developers" className="flex items-center gap-2.5">
          <Mark size={30} />
          <span className="text-[15px] font-semibold tracking-tight text-ink">
            Dialog <span className="font-normal text-muted">Developers</span>
          </span>
        </Link>
        <DevNav signedIn={Boolean(dev)} />
        <div className="ml-auto flex items-center gap-2">
          {dev ? (
            <>
              <span className="hidden text-[13px] text-muted sm:inline" title={dev.email}>
                {dev.org}
              </span>
              <SignOutButton />
            </>
          ) : (
            <Link href="/developers/login" className="inline-flex h-8 items-center rounded-lg bg-brand px-3 text-[13px] font-semibold text-white shadow-[var(--shadow-xs)] hover:bg-[color-mix(in_srgb,var(--color-brand)_90%,#000)]">
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
