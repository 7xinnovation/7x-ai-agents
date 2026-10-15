import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentDeveloper } from "@/lib/developer/session";
import { LoginClient } from "./LoginClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in" };

/** Developer sign-in. A signed-in developer has nothing to do here and goes to their applications. */
export default async function DeveloperLogin() {
  const dev = await currentDeveloper();
  if (dev) redirect("/developers/apps");
  return <LoginClient />;
}
