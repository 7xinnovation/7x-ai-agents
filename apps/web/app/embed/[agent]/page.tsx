import { notFound } from "next/navigation";
import { getAgentBySlug } from "@/lib/agents";
import { uaePassConfigured, uaePassDirectSignInUsable } from "@/lib/uaepass";
import { turnstileSiteKey } from "@/lib/turnstile";
import { Experience } from "./Experience";
import type { PublicAgent } from "./types";
import type { AgentDefinition } from "@dialog/config";
import { epUsersBaseUrl } from "@/lib/hostToken";

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
  let pub = { ...publicAgent(d), appSignIn: await appSignIn(agent.id, d) };
  if (d.delegates?.length) {
    // A master agent: each delegate's public settings, read live from its own row.
    const children = (
      await Promise.all(d.delegates.map((x) => getAgentBySlug(x.slug).catch(() => null)))
    ).filter((a): a is NonNullable<typeof a> => Boolean(a && a.status !== "disabled" && !a.definition.delegates?.length));
    const delegates = await Promise.all(
      children.map(async (c) => ({
        ...publicAgent(c.definition),
        appSignIn: await appSignIn(c.id, c.definition),
        // No source chips under a master: "should not be showing sources"
        // (11 November) — EPGL's knowledge-base chips under an Emirates Post
        // assistant. ep-master's own config says true, so the config is not
        // what decides it here.
        showSources: false,
      }))
    );
    if (!delegates.length) notFound();
    const first = d.defaultDelegate && delegates.some((x) => x.slug === d.defaultDelegate) ? d.defaultDelegate : delegates[0]!.slug;
    pub = {
      ...pub,
      // Every delegate's journeys, so the progress view knows whichever is running.
      journeys: delegates.flatMap((x) => x.journeys),
      delegates,
      defaultDelegate: first,
      showSources: false,
    };
  }

  const initialLocale = (locale === "ar" || locale === "en" ? locale : d.locales[0]) ?? "en";
  // Open straight into a journey — "Renew" pressed beside a box on the host's
  // page or in the app (2026-10-08): ?journey=personal_po_box_renewal&box=450293&emirate=DXB
  const initialStart = journey || box ? { journey, box, emirate } : undefined;
  return <Experience agent={pub} initialLocale={initialLocale} initialConversationId={cid} uaePassToken={upt} embedded={embedded === "1"} initialStart={initialStart} />;
}

/** Can the mobile app's Emirates Post sign-in be checked by this agent? */
async function appSignIn(id: string, d: AgentDefinition): Promise<boolean> {
  try {
    return Boolean(await epUsersBaseUrl(id, d.activeEnvironment ?? "production"));
  } catch {
    return true; // unknown: keep the behaviour every agent had before
  }
}

function publicAgent(d: AgentDefinition): PublicAgent {
  return {
    slug: d.slug,
    name: d.name,
    locales: d.locales,
    greeting: d.greeting,
    readyPrompts: d.readyPrompts,
    theme: d.theme,
    allowedOrigins: d.allowedOrigins,
    documentsDisclaimer: d.documentsDisclaimer,
    documentsInChat: d.documentsInChat,
    progressPlacement: d.progressPlacement ?? "panel",
    uploadsPerMessage: d.uploadsPerMessage,
    showActivityLog: d.showActivityLog ?? false,
    showSources: d.showSources ?? true,
    journeys: d.journeys.map((j) => ({
      key: j.key,
      title: j.title,
      steps: j.steps.map((s) => ({
        key: s.key,
        title: s.title,
        fields: s.fields.map((f) => ({ key: f.key, label: f.label, type: f.type, required: f.validation.required, condition: f.condition, editable: f.editable, options: f.options })),
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
    uaePassDirect: uaePassConfigured() && uaePassDirectSignInUsable(),
    voiceEnabled: Boolean(process.env.AZURE_REALTIME_KEY && process.env.AZURE_REALTIME_ENDPOINT),
    // Only the postal side files on /nextApi/case; EPGL callbacks are Salesforce
    // cases and need no CAPTCHA, so they never load Cloudflare's script.
    turnstileSiteKey: d.tenantSlug === "epgl" ? undefined : turnstileSiteKey() || undefined,
  };
}
