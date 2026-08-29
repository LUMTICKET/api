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

/* ── NEW: Team invitations table ── */
export const teamInvitations = pgTable("team_invitations", {
  id: serial("id").primaryKey(),
  businessProfileId: integer("business_profile_id")
    .notNull()
    .references(() => businessProfiles.id, { onDelete: "cascade" }),
  email: varchar("email", { length: 255 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  role: varchar("role", { length: 50 }).notNull().$type<"admin" | "operator" | "viewer">(),
  token: varchar("token", { length: 255 }).notNull().unique(),
  status: varchar("status", { length: 20 })
    .notNull()
    .default("pending")
    .$type<"pending" | "accepted" | "expired">(),
  invitedBy: integer("invited_by")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
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
  invitationId: integer("invitation_id")
    .notNull()
    .references(() => teamInvitations.id, { onDelete: "cascade" })
    .unique(),
  joinedAt: timestamp("joined_at", { mode: "date" }).defaultNow().notNull(),
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
}));

export const businessProfilesRelations = relations(businessProfiles, ({ one, many }) => ({
  user: one(users, {
    fields: [businessProfiles.userId],
    references: [users.id],
  }),
  teamMembers: many(teamMembers),
  invitations: many(teamInvitations),
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
  invitation: one(teamInvitations, {
    fields: [teamMembers.invitationId],
    references: [teamInvitations.id],
  }),
}));

/* ── Types ── */
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type BusinessProfile = typeof businessProfiles.$inferSelect;
export type NewBusinessProfile = typeof businessProfiles.$inferInsert;
export type TeamInvitation = typeof teamInvitations.$inferSelect;
export type NewTeamInvitation = typeof teamInvitations.$inferInsert;
export type TeamMember = typeof teamMembers.$inferSelect;
export type NewTeamMember = typeof teamMembers.$inferInsert;

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