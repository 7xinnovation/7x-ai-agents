import { notFound } from "next/navigation";
import { getAgentBySlug } from "@/lib/agents";
import { uaePassConfigured } from "@/lib/uaepass";
import { Experience } from "./Experience";
import type { PublicAgent } from "./types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function EmbedPage({
  params,
  searchParams,
}: {
  params: Promise<{ agent: string }>;
  searchParams: Promise<{ locale?: string; embedded?: string; cid?: string; upt?: string; journey?: string; box?: string; emirate?: string }>;
}) {
  const { agent: slug } = await params;
  const { locale, cid, upt, embedded, journey, box, emirate } = await searchParams;
  const agent = await getAgentBySlug(slug);
  if (!agent) notFound();

  const d = agent.definition;
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
    hostLogoutUrl: d.hostLogoutUrl,
    nativeUaePassFallback: d.nativeUaePassFallback,
    stackedChoices: d.stackedChoices,
    uaePassEnabled: uaePassConfigured(),
    voiceEnabled: Boolean(process.env.AZURE_REALTIME_KEY && process.env.AZURE_REALTIME_ENDPOINT),
  };

  const initialLocale = (locale === "ar" || locale === "en" ? locale : d.locales[0]) ?? "en";
  // Open straight into a journey — "Renew" pressed beside a box on the host's
  // page or in the app (2026-10-08): ?journey=personal_po_box_renewal&box=450293&emirate=DXB
  const initialStart = journey || box ? { journey, box, emirate } : undefined;
  return <Experience agent={pub} initialLocale={initialLocale} initialConversationId={cid} uaePassToken={upt} embedded={embedded === "1"} initialStart={initialStart} />;
}
