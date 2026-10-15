"use client";

import { useEffect, useState } from "react";
import { CodeBlock } from "./CodeBlock";

const PLACEHOLDER = "https://<host>";

/**
 * The origin the docs are being read on. Server-rendered as a placeholder and
 * replaced after mount, so the samples a reader copies point at the deployment
 * in front of them.
 */
function useHost(): string {
  const [host, setHost] = useState<string>(PLACEHOLDER);
  useEffect(() => {
    if (typeof window !== "undefined" && window.location?.origin) setHost(window.location.origin);
  }, []);
  return host;
}

/** `{{HOST}}` in a sample becomes this deployment's origin. */
export function DocsCode({ code, title, lang }: { code: string; title?: string; lang?: "bash" | "json" | "js" | "python" | "text" | "http" }) {
  const host = useHost();
  return <CodeBlock code={code.split("{{HOST}}").join(host)} title={title} lang={lang} />;
}

/** The origin, inline. */
export function DocsHost({ path = "" }: { path?: string }) {
  const host = useHost();
  return <code>{`${host}${path}`}</code>;
}
