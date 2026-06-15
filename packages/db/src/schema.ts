import {
  pgTable,
  uuid,
  text,
  jsonb,
  boolean,
  timestamp,
  integer,
  index,
  customType,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type {
  AgentDefinition,
  CaseState,
} from "@dialog/config";

/**
 * pgvector column. Dimension matches the embedding model used by the KB adapter
 * (Voyage voyage-3 = 1024). Nullable so chunks can exist before embedding and so
 * a keyword-only fallback works without an embeddings provider.
 */
const EMBEDDING_DIM = 1024;
export const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return `vector(${EMBEDDING_DIM})`;
  },
  toDriver(value) {
    return `[${value.join(",")}]`;
  },
  fromDriver(value) {
    return value.replace(/[[\]]/g, "").split(",").map(Number);
  },
});

const ts = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();

/** A company / brand under the group. Tenant-level isolation key for everything. */
export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  // Data residency, retention windows, PDPL settings, etc.
  settings: jsonb("settings").$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: ts(),
});

/**
 * One embeddable agent. `definition` holds the full validated AgentDefinition
 * (branding, locales, intents, journeys, guardrails, integration bindings).
 * This is the unit the platform "generates".
 */
export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    status: text("status", { enum: ["draft", "live", "disabled"] })
      .default("draft")
      .notNull(),
    definition: jsonb("definition").$type<AgentDefinition>().notNull(),
    createdAt: ts(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({ tenantIdx: index("agents_tenant_idx").on(t.tenantId) })
);

/** A version-controlled knowledge-base source document (PRD: named KB owner + version). */
export const kbDocuments = pgTable(
  "kb_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    source: text("source"),
    version: text("version").notNull().default("1"),
    locale: text("locale", { enum: ["en", "ar"] }).default("en").notNull(),
    // Publishing lifecycle (PRD: only published content is retrieved).
    status: text("status", { enum: ["draft", "published", "archived"] })
      .default("published")
      .notNull(),
    createdAt: ts(),
  },
  (t) => ({ agentIdx: index("kb_docs_agent_idx").on(t.agentId) })
);

/** Chunked, embedded KB content used for grounded retrieval. */
export const kbChunks = pgTable(
  "kb_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => kbDocuments.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    embedding: vector("embedding"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: ts(),
  },
  (t) => ({ agentIdx: index("kb_chunks_agent_idx").on(t.agentId) })
);

/** One conversation session with an agent. */
export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    locale: text("locale", { enum: ["en", "ar"] }).default("en").notNull(),
    // External identity once authenticated (e.g. UAE PASS subject). Null = guest.
    userRef: text("user_ref"),
    authenticated: boolean("authenticated").default(false).notNull(),
    createdAt: ts(),
  },
  (t) => ({ agentIdx: index("conversations_agent_idx").on(t.agentId) })
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant", "system", "tool"] }).notNull(),
    content: text("content").notNull(),
    // Tool calls, citations, confidence, intent, etc.
    meta: jsonb("meta").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: ts(),
  },
  (t) => ({ convIdx: index("messages_conversation_idx").on(t.conversationId) })
);

/** The case being assembled by a conversation — what the right panel renders. */
export const cases = pgTable(
  "cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    state: jsonb("state").$type<CaseState>().notNull(),
    createdAt: ts(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({ convIdx: index("cases_conversation_idx").on(t.conversationId) })
);

/** Uploaded documents bound to a case. */
export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  caseId: uuid("case_id")
    .notNull()
    .references(() => cases.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  status: text("status", {
    enum: ["pending", "uploaded", "rejected", "accepted"],
  })
    .default("pending")
    .notNull(),
  fileName: text("file_name"),
  storageKey: text("storage_key"),
  rejectionReason: text("rejection_reason"),
  createdAt: ts(),
});

/** Human escalation / callback request mirrored to the CRM (PRD: Salesforce callbacks). */
export const escalations = pgTable("escalations", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id")
    .notNull()
    .references(() => agents.id, { onDelete: "cascade" }),
  reason: text("reason").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().default({}).notNull(),
  externalRef: text("external_ref"),
  createdAt: ts(),
});

/** Payment transactions through the gateway (PRD: payment lifecycle + reconciliation). */
export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "set null" }),
    conversationId: uuid("conversation_id"),
    agentId: uuid("agent_id"),
    reference: text("reference").notNull().unique(),
    amount: integer("amount").notNull(), // minor units or whole AED; demo uses whole
    currency: text("currency").default("AED").notNull(),
    status: text("status", { enum: ["initiated", "paid", "failed"] }).default("initiated").notNull(),
    gatewayRef: text("gateway_ref"),
    createdAt: ts(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ refIdx: index("payments_ref_idx").on(t.reference) })
);

/** Standardized analytics events across all journeys (PRD: analytics taxonomy). */
export const analyticsEvents = pgTable(
  "analytics_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id"),
    conversationId: uuid("conversation_id"),
    type: text("type").notNull(), // conversation.started, journey.completed, payment.completed, ...
    attributes: jsonb("attributes").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: ts(),
  },
  (t) => ({
    typeIdx: index("analytics_type_idx").on(t.type),
    agentIdx: index("analytics_agent_idx").on(t.agentId),
  })
);

/** Audit trail for every critical AI/transactional action (PRD: audit logging). */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id"),
    conversationId: uuid("conversation_id"),
    actor: text("actor").notNull(), // "user" | "agent" | "system"
    action: text("action").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: ts(),
  },
  (t) => ({ agentIdx: index("audit_agent_idx").on(t.agentId) })
);

/**
 * API integrations imported from an OpenAPI/Swagger spec. Each integration's
 * operations become callable tools the agent can use during a conversation.
 */
export const agentIntegrations = pgTable(
  "agent_integrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    specUrl: text("spec_url").notNull(),
    baseUrl: text("base_url").notNull(),
    authType: text("auth_type", { enum: ["none", "bearer", "apiKey"] }).default("none").notNull(),
    authValue: text("auth_value"), // token / api key (scaffold: stored as-is)
    authHeader: text("auth_header"), // header name for apiKey auth
    operations: jsonb("operations").$type<Record<string, unknown>[]>().default([]).notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    createdAt: ts(),
  },
  (t) => ({ agentIdx: index("integrations_agent_idx").on(t.agentId) })
);

// Ensure the pgvector extension exists (applied via raw SQL in push/seed).
export const ensureVectorExtension = sql`CREATE EXTENSION IF NOT EXISTS vector;`;
