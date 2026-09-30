import { notFound } from "next/navigation";
import { getAgentBySlug } from "@/lib/agents";
import { uaePassConfigured, uaePassRedirectsToUs } from "@/lib/uaepass";
import { headers } from "next/headers";
import { Experience } from "./Experience";
import type { PublicAgent } from "./types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function EmbedPage({
  params,
  searchParams,
}: {
  params: Promise<{ agent: string }>;
  searchParams: Promise<{ locale?: string; embedded?: string; cid?: string; upt?: string }>;
}) {
  const { agent: slug } = await params;
  const { locale, cid, upt, embedded } = await searchParams;
  const agent = await getAgentBySlug(slug);
  if (!agent) notFound();

  const d = agent.definition;
  /**
   * Where this page is being served from, for the UAE PASS question below: a
   * client accepts only the redirect URIs registered against it, and whether
   * OUR callback is one of them depends on the deployment.
   */
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const origin = host ? `${proto}://${host}` : "";
  const pub: PublicAgent = {
    slug: d.slug,
    name: d.name,
    locales: d.locales,
    greeting: d.greeting,
    theme: d.theme,
    allowedOrigins: d.allowedOrigins,
    documentsDisclaimer: d.documentsDisclaimer,
    documentsInChat: d.documentsInChat,
    progressPlacement: d.progressPlacement ?? "panel",
    uploadsPerMessage: d.uploadsPerMessage,
    showActivityLog: d.showActivityLog ?? false,
    journeys: d.journeys.map((j) => ({
      key: j.key,
      title: j.title,
      steps: j.steps.map((s) => ({
        key: s.key,
        title: s.title,
        fields: s.fields.map((f) => ({ key: f.key, label: f.label, type: f.type, required: f.validation.required, condition: f.condition, editable: f.editable })),
        documents: s.documents.map((doc) => ({
          key: doc.key,
          label: doc.label,
          requirement: doc.requirement,
          condition: doc.condition,
          acceptedFormats: doc.acceptedFormats,
          maxSizeMb: doc.maxSizeMb,
        })),
      })),
    })),
    hostLoginUrl: d.hostLoginUrl,
    nativeUaePassFallback: d.nativeUaePassFallback,
    // Whether OUR UAE PASS callback is one this tenant's client accepts. See
    // uaePassRedirectsToUs — on production NXN it is Emirates Post's portal.
    uaePassOwnFlow: uaePassRedirectsToUs(origin, d.tenantSlug),
    stackedChoices: d.stackedChoices,
    uaePassEnabled: uaePassConfigured(),
    voiceEnabled: Boolean(process.env.AZURE_REALTIME_KEY && process.env.AZURE_REALTIME_ENDPOINT),
  };

  const initialLocale = (locale === "ar" || locale === "en" ? locale : d.locales[0]) ?? "en";
  return <Experience agent={pub} initialLocale={initialLocale} initialConversationId={cid} uaePassToken={upt} embedded={embedded === "1"} />;
}
