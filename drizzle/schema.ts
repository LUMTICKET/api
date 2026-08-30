import { relations } from "drizzle-orm";
import {
  pgTable,
  serial,
  varchar,
  timestamp,
  text,
  integer,
  boolean,
  jsonb,
} from "drizzle-orm/pg-core";

/* ── existing users table ── */
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  password: text("password"),
  name: varchar("name", { length: 255 }),
  avatar: text("avatar"),
  googleId: varchar("google_id", { length: 255 }).unique(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const sessions = pgTable("sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  email: varchar("email", { length: 255 }).notNull(),
  sessionId: varchar("session_id", { length: 255 }).notNull().unique(),
  refreshTokenHash: varchar("refresh_token_hash", { length: 255 }).notNull(),
  userAgent: varchar("user_agent", { length: 255 }),
  ipAddress: varchar("ip_address", { length: 255 }),
  expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
  refreshExpiresAt: timestamp("refresh_expires_at", { mode: "date" }).notNull(),
  revokedAt: timestamp("revoked_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

/* ── KYB / business profile table ── */
export const businessProfiles = pgTable("business_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" })
    .unique(),
  type: varchar("type", { length: 20 }).notNull().$type<"individual" | "company">(),
  businessName: varchar("business_name", { length: 255 }).notNull(),
  tradingName: varchar("trading_name", { length: 255 }),
  registrationNumber: varchar("registration_number", { length: 100 }),
  taxId: varchar("tax_id", { length: 100 }),
  email: varchar("email", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 50 }).notNull(),
  address: varchar("address", { length: 255 }).notNull(),
  city: varchar("city", { length: 100 }).notNull(),
  country: varchar("country", { length: 100 }).notNull(),
  website: varchar("website", { length: 255 }),
  description: text("description"),
  category: varchar("category", { length: 100 }),
  isVerified: boolean("is_verified").default(false).notNull(),
  executives: jsonb("executives").$type<Executive[]>().default([]),
  documents: jsonb("documents").$type<BusinessDoc[]>().default([]),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const teamRoles = pgTable("team_roles", {
  id: serial("id").primaryKey(),
  businessProfileId: integer("business_profile_id")
    .notNull()
    .references(() => businessProfiles.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  permissions: jsonb("permissions").$type<string[]>().default([]),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

/* ── NEW: Team invitations table ── */
export const teamInvitations = pgTable("team_invitations", {
  id: serial("id").primaryKey(),
  businessProfileId: integer("business_profile_id")
    .notNull()
    .references(() => businessProfiles.id, { onDelete: "cascade" }),
  email: varchar("email", { length: 255 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  role: varchar("role", { length: 50 }).notNull().$type<"admin" | "operator" | "viewer">(),
  roleId: integer("role_id").references(() => teamRoles.id, { onDelete: "set null" }),
  token: varchar("token", { length: 255 }).notNull().unique(),
  status: varchar("status", { length: 20 })
    .notNull()
    .default("pending")
    .$type<"pending" | "accepted" | "expired">(),
  invitedBy: integer("invited_by")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
  acceptedAt: timestamp("accepted_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

/* ── NEW: Team members table (accepted invitations) ── */
export const teamMembers = pgTable("team_members", {
  id: serial("id").primaryKey(),
  businessProfileId: integer("business_profile_id")
    .notNull()
    .references(() => businessProfiles.id, { onDelete: "cascade" }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  role: varchar("role", { length: 50 }).notNull().$type<"admin" | "operator" | "viewer">(),
  roleId: integer("role_id").references(() => teamRoles.id, { onDelete: "set null" }),
  invitationId: integer("invitation_id")
    .notNull()
    .references(() => teamInvitations.id, { onDelete: "cascade" })
    .unique(),
  joinedAt: timestamp("joined_at", { mode: "date" }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  actorUserId: integer("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  targetUserId: integer("target_user_id").references(() => users.id, { onDelete: "set null" }),
  businessProfileId: integer("business_profile_id").references(() => businessProfiles.id, { onDelete: "cascade" }),
  teamRoleId: integer("team_role_id").references(() => teamRoles.id, { onDelete: "set null" }),
  teamInvitationId: integer("team_invitation_id").references(() => teamInvitations.id, { onDelete: "set null" }),
  action: varchar("action", { length: 80 }).notNull(),
  resourceType: varchar("resource_type", { length: 50 }).notNull(),
  resourceId: integer("resource_id"),
  details: jsonb("details").default({}),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  businessProfileId: integer("business_profile_id")
    .notNull()
    .references(() => businessProfiles.id, { onDelete: "cascade" }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  provider: varchar("provider", { length: 50 }).notNull().default("simulation"),
  method: varchar("method", { length: 30 }).notNull().$type<"card" | "tnm" | "airtel">(),
  amount: integer("amount").notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("MWK"),
  status: varchar("status", { length: 20 })
    .notNull()
    .default("pending")
    .$type<"pending" | "succeeded" | "failed">(),
  reference: varchar("reference", { length: 100 }).notNull().unique(),
  metadata: jsonb("metadata").default({}),
  paidAt: timestamp("paid_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const events = pgTable("events", {
  id: serial("id").primaryKey(),
  businessProfileId: integer("business_profile_id")
    .notNull()
    .references(() => businessProfiles.id, { onDelete: "cascade" }),
  createdBy: integer("created_by")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  paymentId: integer("payment_id")
    .notNull()
    .unique()
    .references(() => payments.id, { onDelete: "restrict" }),
  title: varchar("title", { length: 255 }).notNull(),
  subtitle: varchar("subtitle", { length: 500 }),
  category: varchar("category", { length: 30 })
    .notNull()
    .default("event")
    .$type<"event" | "bus" | "flight" | "tourism">(),
  organizer: varchar("organizer", { length: 255 }),
  description: text("description"),
  location: varchar("location", { length: 255 }).notNull(),
  startsAt: timestamp("starts_at", { mode: "date" }).notNull(),
  endsAt: timestamp("ends_at", { mode: "date" }),
  image: text("image"),
  tags: jsonb("tags").$type<string[]>().default([]),
  maxPerUser: integer("max_per_user").notNull().default(5),
  status: varchar("status", { length: 20 }).notNull().default("published").$type<"draft" | "published" | "cancelled">(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const ticketTypes = pgTable("ticket_types", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 100 }).notNull(),
  price: integer("price").notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("MWK"),
  perks: jsonb("perks").$type<string[]>().default([]),
  capacity: integer("capacity").notNull(),
  remaining: integer("remaining").notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

/* ── Relations ── */
export const usersRelations = relations(users, ({ one, many }) => ({
  businessProfile: one(businessProfiles, {
    fields: [users.id],
    references: [businessProfiles.userId],
  }),
  teamMemberships: many(teamMembers),
  sentInvitations: many(teamInvitations, {
    relationName: "sentInvitations",
  }),
  rolesCreated: many(teamRoles),
  auditLogs: many(auditLogs),
  payments: many(payments),
  eventsCreated: many(events),
}));

export const teamRolesRelations = relations(teamRoles, ({ one, many }) => ({
  businessProfile: one(businessProfiles, {
    fields: [teamRoles.businessProfileId],
    references: [businessProfiles.id],
  }),
  createdByUser: one(users, {
    fields: [teamRoles.createdBy],
    references: [users.id],
  }),
  invitations: many(teamInvitations),
  members: many(teamMembers),
  auditLogs: many(auditLogs),
}));

export const businessProfilesRelations = relations(businessProfiles, ({ one, many }) => ({
  user: one(users, {
    fields: [businessProfiles.userId],
    references: [users.id],
  }),
  teamMembers: many(teamMembers),
  invitations: many(teamInvitations),
  payments: many(payments),
  events: many(events),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  businessProfile: one(businessProfiles, {
    fields: [payments.businessProfileId],
    references: [businessProfiles.id],
  }),
  user: one(users, { fields: [payments.userId], references: [users.id] }),
}));

export const eventsRelations = relations(events, ({ one, many }) => ({
  businessProfile: one(businessProfiles, {
    fields: [events.businessProfileId],
    references: [businessProfiles.id],
  }),
  creator: one(users, { fields: [events.createdBy], references: [users.id] }),
  payment: one(payments, { fields: [events.paymentId], references: [payments.id] }),
  ticketTypes: many(ticketTypes),
}));

export const ticketTypesRelations = relations(ticketTypes, ({ one }) => ({
  event: one(events, { fields: [ticketTypes.eventId], references: [events.id] }),
}));

export const teamInvitationsRelations = relations(teamInvitations, ({ one }) => ({
  businessProfile: one(businessProfiles, {
    fields: [teamInvitations.businessProfileId],
    references: [businessProfiles.id],
  }),
  invitedBy: one(users, {
    fields: [teamInvitations.invitedBy],
    references: [users.id],
    relationName: "sentInvitations",
  }),
  createdByUser: one(users, {
    fields: [teamInvitations.createdBy],
    references: [users.id],
  }),
  role: one(teamRoles, {
    fields: [teamInvitations.roleId],
    references: [teamRoles.id],
  }),
  acceptedBy: one(teamMembers, {
    fields: [teamInvitations.id],
    references: [teamMembers.invitationId],
  }),
}));

export const teamMembersRelations = relations(teamMembers, ({ one }) => ({
  businessProfile: one(businessProfiles, {
    fields: [teamMembers.businessProfileId],
    references: [businessProfiles.id],
  }),
  user: one(users, {
    fields: [teamMembers.userId],
    references: [users.id],
  }),
  role: one(teamRoles, {
    fields: [teamMembers.roleId],
    references: [teamRoles.id],
  }),
  invitation: one(teamInvitations, {
    fields: [teamMembers.invitationId],
    references: [teamInvitations.id],
  }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  actor: one(users, {
    fields: [auditLogs.actorUserId],
    references: [users.id],
  }),
  targetUser: one(users, {
    fields: [auditLogs.targetUserId],
    references: [users.id],
  }),
  businessProfile: one(businessProfiles, {
    fields: [auditLogs.businessProfileId],
    references: [businessProfiles.id],
  }),
  teamRole: one(teamRoles, {
    fields: [auditLogs.teamRoleId],
    references: [teamRoles.id],
  }),
  invitation: one(teamInvitations, {
    fields: [auditLogs.teamInvitationId],
    references: [teamInvitations.id],
  }),
}));

/* ── Types ── */
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type BusinessProfile = typeof businessProfiles.$inferSelect;
export type NewBusinessProfile = typeof businessProfiles.$inferInsert;
export type TeamRoleRecord = typeof teamRoles.$inferSelect;
export type NewTeamRoleRecord = typeof teamRoles.$inferInsert;
export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
export type TeamInvitation = typeof teamInvitations.$inferSelect;
export type NewTeamInvitation = typeof teamInvitations.$inferInsert;
export type TeamMember = typeof teamMembers.$inferSelect;
export type NewTeamMember = typeof teamMembers.$inferInsert;
export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;
export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type TicketType = typeof ticketTypes.$inferSelect;
export type NewTicketType = typeof ticketTypes.$inferInsert;

export interface Executive {
  id: string;
  fullName: string;
  role: string;
  email: string;
  phone: string;
  nationalIdNumber: string;
}

export interface BusinessDoc {
  id: string;
  type: DocType;
  title: string;
  status: "pending" | "approved" | "rejected";
  uploadedAt: string;
}

export type DocType =
  | "registration_certificate"
  | "tax_clearance"
  | "business_license"
  | "national_id"
  | "other";

export type TeamRole = "admin" | "operator" | "viewer";