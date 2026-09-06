import { notFound } from "next/navigation";
import { Editor } from "./Editor";
import { currentScope } from "@/lib/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminEdit({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // An agent outside the caller's scope does not exist as far as they are concerned.
  const scope = await currentScope();
  if (scope && !scope.includes(slug)) notFound();
  return <Editor slug={slug} />;
}
