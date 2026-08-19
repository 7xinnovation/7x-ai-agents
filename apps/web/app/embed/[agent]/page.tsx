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
  searchParams: Promise<{ locale?: string; embedded?: string; cid?: string; upt?: string }>;
}) {
  const { agent: slug } = await params;
  const { locale, cid, upt, embedded } = await searchParams;
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
    uploadsPerMessage: d.uploadsPerMessage,
    journeys: d.journeys.map((j) => ({
      key: j.key,
      title: j.title,
      steps: j.steps.map((s) => ({
        key: s.key,
        title: s.title,
        fields: s.fields.map((f) => ({ key: f.key, label: f.label, type: f.type, required: f.validation.required, editable: f.editable })),
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
    uaePassEnabled: uaePassConfigured(),
    voiceEnabled: Boolean(process.env.AZURE_REALTIME_KEY && process.env.AZURE_REALTIME_ENDPOINT),
  };

  const initialLocale = (locale === "ar" || locale === "en" ? locale : d.locales[0]) ?? "en";
  return <Experience agent={pub} initialLocale={initialLocale} initialConversationId={cid} uaePassToken={upt} embedded={embedded === "1"} />;
}
