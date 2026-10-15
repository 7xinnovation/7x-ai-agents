import Link from "next/link";
import { currentDeveloper } from "@/lib/developer/session";
import { Mark } from "./Mark";
import { SignOutButton } from "./SignOutButton";
import { DevNav } from "./DevNav";

/**
 * The portal's header: an environment strip that says plainly this is the
 * sandbox, then the product bar. A server component, so the account comes
 * from the cookie without a round trip; the nav highlights itself on the client.
 */
export async function DevHeader() {
  const dev = await currentDeveloper();
  return (
    <header className="sticky top-0 z-30">
      <div className="bg-[#0f1720] text-[12px] text-white/70">
        <div className="mx-auto flex h-8 max-w-[1200px] items-center justify-between gap-4 px-4 sm:px-6">
          <span>
            <span className="font-medium text-white">Sandbox environment.</span> Test data only. No box is rented and no payment is taken.
          </span>
          <span className="hidden sm:inline">A2A protocol 1.0</span>
        </div>
      </div>
      <div className="border-b border-[var(--color-line)] bg-white">
        <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-8 px-4 sm:px-6">
          <Link href="/developers" className="flex items-center gap-2.5" aria-label="Dialog Developers home">
            <Mark size={28} />
            <span className="text-[14.5px] font-semibold text-ink">
              Dialog <span className="font-normal text-muted">Developers</span>
            </span>
          </Link>
          <DevNav signedIn={Boolean(dev)} />
          <div className="ml-auto flex items-center gap-3">
            {dev ? (
              <>
                <span className="hidden text-right leading-tight sm:block">
                  <span className="block text-[13px] font-medium text-ink">{dev.org}</span>
                  <span className="block text-[11.5px] text-muted">{dev.email}</span>
                </span>
                <span className="hidden h-6 w-px bg-[var(--color-line)] sm:block" aria-hidden />
                <SignOutButton />
              </>
            ) : (
              <Link
                href="/developers/login"
                className="inline-flex h-8 items-center rounded-[3px] bg-[#1330f0] px-3.5 text-[13px] font-medium text-white hover:bg-[#0f27c4] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--color-ring)]"
              >
                Sign in
              </Link>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
