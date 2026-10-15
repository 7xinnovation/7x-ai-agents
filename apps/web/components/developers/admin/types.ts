/**
 * Row shapes for the admin pages, taken from the functions behind the admin
 * API so the pages and the routes cannot drift apart. Type-only imports: no
 * server code reaches the browser.
 */
import type { adminEvents, adminOverview, adminRequests, adminTask, adminTasks, listAccounts, listAllApps } from "@/lib/developer/admin";
import type { PortalSettings } from "@/lib/developer/settings";

export type Overview = Awaited<ReturnType<typeof adminOverview>>;
export type AccountRow = Awaited<ReturnType<typeof listAccounts>>[number];
export type AppRow = Awaited<ReturnType<typeof listAllApps>>[number];
export type RequestRow = Awaited<ReturnType<typeof adminRequests>>["requests"][number];
export type TaskRow = Awaited<ReturnType<typeof adminTasks>>["tasks"][number];
export type EventRow = Awaited<ReturnType<typeof adminEvents>>["events"][number];
export type TaskDetail = NonNullable<Awaited<ReturnType<typeof adminTask>>>;
export type AgentOption = { key: string; name: string; sandbox?: boolean };
export type SettingsMeta = Record<string, { updatedBy: string | null; updatedAt: string }>;
export type { PortalSettings };
