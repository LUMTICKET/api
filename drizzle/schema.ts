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
  numeric,
  date,
  unique,
  foreignKey,
} from "drizzle-orm/pg-core";

/* ── Business types (reference/lookup table, seeded by default) ── */
export const businessTypes = pgTable("business_types", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  description: text("description"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

/* ── existing users table ── */
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  password: text("password"),
  name: varchar("name", { length: 255 }),
  country: varchar("country", { length: 2 }),
  businessTypeId: integer("business_type_id").references(() => businessTypes.id, {
    onDelete: "set null",
  }),
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
  commissionRate: numeric("commission_rate", { precision: 5, scale: 2 }),
  accountStatus: varchar("account_status", { length: 20 })
    .notNull()
    .default("active")
    .$type<"active" | "suspended">(),
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
  venue: varchar("venue", { length: 255 }),
  city: varchar("city", { length: 100 }),
  countryCode: varchar("country_code", { length: 2 }),
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
  businessType: one(businessTypes, {
    fields: [users.businessTypeId],
    references: [businessTypes.id],
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

export const businessTypesRelations = relations(businessTypes, ({ many }) => ({
  users: many(users),
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
export type BusinessType = typeof businessTypes.$inferSelect;
export type NewBusinessType = typeof businessTypes.$inferInsert;
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

/* ════════════════════════════════════════════════════════════════
   Operational tables (catalog, bookings, fleet, field ops, finance,
   platform admin) — see "Database Requirements" spec / API.md
   ════════════════════════════════════════════════════════════════ */

/* ── §1.1 Countries (public catalog) ── */
export const countries = pgTable("countries", {
  code: varchar("code", { length: 2 }).primaryKey(),
  name: text("name").notNull(),
  currency: varchar("currency", { length: 3 }).notNull(),
  flag: varchar("flag", { length: 8 }),
  live: boolean("live").default(false).notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

/* ── §1.2 Bus routes (public catalog) ── */
export const busRoutes = pgTable("bus_routes", {
  id: serial("id").primaryKey(),
  businessProfileId: integer("business_profile_id")
    .notNull()
    .references(() => businessProfiles.id, { onDelete: "cascade" }),
  origin: varchar("origin", { length: 255 }).notNull(),
  destination: varchar("destination", { length: 255 }).notNull(),
  duration: varchar("duration", { length: 50 }),
  fromPrice: integer("from_price"),
  currency: varchar("currency", { length: 3 }).notNull().default("MWK"),
  departuresPerDay: integer("departures_per_day").default(1).notNull(),
  rating: numeric("rating", { precision: 2, scale: 1 }),
  isPublished: boolean("is_published").default(true).notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

/* ── §2.1 Unified customer bookings (read model over bus/event/parcel) ── */
export const bookings = pgTable("bookings", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  kind: varchar("kind", { length: 20 })
    .notNull()
    .$type<"bus" | "event" | "parcel">(),
  reference: varchar("reference", { length: 64 }).notNull().unique(),
  title: text("title").notNull(),
  detail: text("detail"),
  scheduledFor: timestamp("scheduled_for", { mode: "date", withTimezone: true }).notNull(),
  amount: integer("amount").notNull().default(0),
  currency: varchar("currency", { length: 3 }).notNull().default("MWK"),
  status: varchar("status", { length: 20 })
    .notNull()
    .default("upcoming")
    .$type<"upcoming" | "completed" | "in-transit" | "delivered" | "cancelled">(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

/* ── §2.2 Operator-side bus bookings ── */
export const busBookings = pgTable("bus_bookings", {
  id: serial("id").primaryKey(),
  businessProfileId: integer("business_profile_id")
    .notNull()
    .references(() => businessProfiles.id, { onDelete: "cascade" }),
  reference: varchar("reference", { length: 64 }).notNull().unique(),
  customerName: varchar("customer_name", { length: 255 }).notNull(),
  scheduleId: integer("schedule_id").references(() => schedules.id, { onDelete: "set null" }),
  seats: jsonb("seats").$type<string[]>().default([]),
  amount: integer("amount").notNull().default(0),
  currency: varchar("currency", { length: 3 }).notNull().default("MWK"),
  channel: varchar("channel", { length: 20 })
    .notNull()
    .default("online")
    .$type<"online" | "pos">(),
  status: varchar("status", { length: 20 })
    .notNull()
    .default("confirmed")
    .$type<"confirmed" | "checked-in" | "cancelled">(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

/* ── §2.3 Parcels + scan history ── */
export const parcels = pgTable("parcels", {
  id: serial("id").primaryKey(),
  businessProfileId: integer("business_profile_id")
    .notNull()
    .references(() => businessProfiles.id, { onDelete: "cascade" }),
  reference: varchar("reference", { length: 64 }).notNull().unique(),
  senderName: varchar("sender_name", { length: 255 }).notNull(),
  recipientName: varchar("recipient_name", { length: 255 }).notNull(),
  origin: varchar("origin", { length: 255 }).notNull(),
  destination: varchar("destination", { length: 255 }).notNull(),
  weightKg: numeric("weight_kg", { precision: 6, scale: 2 }),
  courierId: integer("courier_id"),
  status: varchar("status", { length: 30 })
    .notNull()
    .default("registered")
    .$type<"registered" | "in-transit" | "out-for-delivery" | "delivered" | "failed">(),
  amount: integer("amount").notNull().default(0),
  currency: varchar("currency", { length: 3 }).notNull().default("MWK"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const parcelEvents = pgTable("parcel_events", {
  id: serial("id").primaryKey(),
  parcelId: integer("parcel_id")
    .notNull()
    .references(() => parcels.id, { onDelete: "cascade" }),
  location: varchar("location", { length: 255 }),
  status: varchar("status", { length: 30 })
    .notNull()
    .$type<"registered" | "in-transit" | "out-for-delivery" | "delivered" | "failed">(),
  scannedBy: varchar("scanned_by", { length: 255 }),
  occurredAt: timestamp("occurred_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
});

/* ── §3 Bus operator operations ── */
export const vehicles = pgTable("vehicles", {
  id: serial("id").primaryKey(),
  businessProfileId: integer("business_profile_id")
    .notNull()
    .references(() => businessProfiles.id, { onDelete: "cascade" }),
  plate: varchar("plate", { length: 30 }).notNull(),
  type: varchar("type", { length: 100 }),
  capacity: integer("capacity").notNull().default(0),
  status: varchar("status", { length: 20 })
    .notNull()
    .default("active")
    .$type<"active" | "maintenance" | "inactive">(),
  roadworthyExpiry: date("roadworthy_expiry"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const drivers = pgTable("drivers", {
  id: serial("id").primaryKey(),
  businessProfileId: integer("business_profile_id")
    .notNull()
    .references(() => businessProfiles.id, { onDelete: "cascade" }),
  userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
  name: varchar("name", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 50 }),
  status: varchar("status", { length: 20 })
    .notNull()
    .default("available")
    .$type<"available" | "on-trip" | "off-duty">(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const schedules = pgTable("schedules", {
  id: serial("id").primaryKey(),
  businessProfileId: integer("business_profile_id")
    .notNull()
    .references(() => businessProfiles.id, { onDelete: "cascade" }),
  routeId: integer("route_id")
    .notNull()
    .references(() => busRoutes.id, { onDelete: "cascade" }),
  vehicleId: integer("vehicle_id").references(() => vehicles.id, { onDelete: "set null" }),
  driverId: integer("driver_id").references(() => drivers.id, { onDelete: "set null" }),
  departureAt: timestamp("departure_at", { mode: "date", withTimezone: true }).notNull(),
  seatsTotal: integer("seats_total").notNull().default(0),
  seatsSold: integer("seats_sold").notNull().default(0),
  status: varchar("status", { length: 20 })
    .notNull()
    .default("scheduled")
    .$type<"scheduled" | "boarding" | "departed" | "completed">(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const driverAssignments = pgTable(
  "driver_assignments",
  {
    id: serial("id").primaryKey(),
    businessProfileId: integer("business_profile_id")
      .notNull()
      .references(() => businessProfiles.id, { onDelete: "cascade" }),
    driverId: integer("driver_id")
      .notNull()
      .references(() => drivers.id, { onDelete: "cascade" }),
    vehicleId: integer("vehicle_id").references(() => vehicles.id, { onDelete: "set null" }),
    scheduleId: integer("schedule_id").references(() => schedules.id, { onDelete: "set null" }),
    status: varchar("status", { length: 20 })
      .notNull()
      .default("upcoming")
      .$type<"upcoming" | "in-progress" | "completed">(),
    passengerCount: integer("passenger_count").notNull().default(0),
    parcelCount: integer("parcel_count").notNull().default(0),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    // Auto-generated inline-FK name (62 chars) exceeds Postgres's 63-char identifier limit.
    foreignKey({
      name: "driver_assignments_profile_fk",
      columns: [table.businessProfileId],
      foreignColumns: [businessProfiles.id],
    }).onDelete("cascade"),
  ],
);

/* ── §4 Field operations, scanning & POS ── */
export const scanEvents = pgTable("scan_events", {
  id: serial("id").primaryKey(),
  businessProfileId: integer("business_profile_id")
    .notNull()
    .references(() => businessProfiles.id, { onDelete: "cascade" }),
  code: varchar("code", { length: 255 }).notNull(),
  kind: varchar("kind", { length: 20 })
    .notNull()
    .$type<"ticket" | "parcel">(),
  result: varchar("result", { length: 20 })
    .notNull()
    .$type<"valid" | "invalid" | "duplicate">(),
  mode: varchar("mode", { length: 20 })
    .notNull()
    .default("auto")
    .$type<"auto" | "manual">(),
  device: varchar("device", { length: 100 }),
  synced: boolean("synced").default(true).notNull(),
  occurredAt: timestamp("occurred_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
});

export const posTransactions = pgTable("pos_transactions", {
  id: serial("id").primaryKey(),
  agentProfileId: integer("agent_profile_id")
    .notNull()
    .references(() => businessProfiles.id, { onDelete: "cascade" }),
  occurredAt: timestamp("occurred_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  kind: varchar("kind", { length: 20 })
    .notNull()
    .$type<"bus-ticket" | "parcel" | "event-ticket">(),
  reference: varchar("reference", { length: 64 }),
  amount: integer("amount").notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("MWK"),
  method: varchar("method", { length: 20 })
    .notNull()
    .default("cash")
    .$type<"cash" | "mobile-money">(),
});

export const tillSessions = pgTable("till_sessions", {
  id: serial("id").primaryKey(),
  agentProfileId: integer("agent_profile_id")
    .notNull()
    .references(() => businessProfiles.id, { onDelete: "cascade" }),
  openedAt: timestamp("opened_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  closedAt: timestamp("closed_at", { mode: "date", withTimezone: true }),
  openingFloat: integer("opening_float").notNull().default(0),
  limitAmount: integer("limit_amount"),
  currency: varchar("currency", { length: 3 }).notNull().default("MWK"),
  cashSales: integer("cash_sales"),
  mobileSales: integer("mobile_sales"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

/* ── §5 Courier operations ── */
export const couriers = pgTable("couriers", {
  id: serial("id").primaryKey(),
  businessProfileId: integer("business_profile_id")
    .notNull()
    .references(() => businessProfiles.id, { onDelete: "cascade" }),
  userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
  name: varchar("name", { length: 255 }).notNull(),
  zone: varchar("zone", { length: 255 }),
  vehicle: varchar("vehicle", { length: 255 }),
  status: varchar("status", { length: 20 })
    .notNull()
    .default("available")
    .$type<"available" | "on-route" | "off-duty">(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const complianceDocuments = pgTable(
  "compliance_documents",
  {
    id: serial("id").primaryKey(),
    businessProfileId: integer("business_profile_id")
      .notNull()
      .references(() => businessProfiles.id, { onDelete: "cascade" }),
    subject: varchar("subject", { length: 255 }).notNull(),
    kind: varchar("kind", { length: 255 }).notNull(),
    expiresAt: date("expires_at").notNull(),
    documentUrl: text("document_url"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    // Auto-generated inline-FK name (64 chars) exceeds Postgres's 63-char identifier limit.
    foreignKey({
      name: "compliance_documents_profile_fk",
      columns: [table.businessProfileId],
      foreignColumns: [businessProfiles.id],
    }).onDelete("cascade"),
  ],
);

/* ── §6 Finance & settlement ── */
export const settlements = pgTable("settlements", {
  id: serial("id").primaryKey(),
  businessProfileId: integer("business_profile_id")
    .notNull()
    .references(() => businessProfiles.id, { onDelete: "cascade" }),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  grossAmount: integer("gross_amount").notNull().default(0),
  commissionAmount: integer("commission_amount").notNull().default(0),
  netAmount: integer("net_amount").notNull().default(0),
  currency: varchar("currency", { length: 3 }).notNull().default("MWK"),
  status: varchar("status", { length: 20 })
    .notNull()
    .default("pending")
    .$type<"pending" | "paid">(),
  paidAt: timestamp("paid_at", { mode: "date", withTimezone: true }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const commissionRules = pgTable("commission_rules", {
  id: serial("id").primaryKey(),
  service: varchar("service", { length: 20 })
    .notNull()
    .unique()
    .$type<"bus" | "events" | "parcels" | "agent" | "gateway">(),
  rate: numeric("rate", { precision: 4, scale: 2 }).notNull(),
  effectiveFrom: timestamp("effective_from", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const reconciliationFlags = pgTable("reconciliation_flags", {
  id: serial("id").primaryKey(),
  gatewayRef: varchar("gateway_ref", { length: 100 }).notNull().unique(),
  amount: integer("amount").notNull().default(0),
  currency: varchar("currency", { length: 3 }).notNull().default("MWK"),
  issue: text("issue"),
  status: varchar("status", { length: 30 })
    .notNull()
    .default("needs-review")
    .$type<"auto-refunded" | "booking-completed" | "needs-review">(),
  detectedAt: timestamp("detected_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
});

/* ── §7 Platform administration ── */
export const kycReviews = pgTable("kyc_reviews", {
  id: serial("id").primaryKey(),
  businessProfileId: integer("business_profile_id")
    .notNull()
    .references(() => businessProfiles.id, { onDelete: "cascade" })
    .unique(),
  submittedAt: timestamp("submitted_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  riskTier: varchar("risk_tier", { length: 10 })
    .notNull()
    .default("low")
    .$type<"low" | "medium" | "high">(),
  status: varchar("status", { length: 20 })
    .notNull()
    .default("pending")
    .$type<"pending" | "approved" | "rejected" | "re-verification">(),
  reviewerId: integer("reviewer_id").references(() => users.id, { onDelete: "set null" }),
  decidedAt: timestamp("decided_at", { mode: "date", withTimezone: true }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const permissions = pgTable("permissions", {
  id: serial("id").primaryKey(),
  key: varchar("key", { length: 64 }).notNull().unique(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const platformRoles = pgTable("platform_roles", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  scope: varchar("scope", { length: 20 })
    .notNull()
    .default("platform")
    .$type<"platform" | "operator" | "field">(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const platformRolePermissions = pgTable("platform_role_permissions", {
  id: serial("id").primaryKey(),
  roleId: integer("role_id")
    .notNull()
    .references(() => platformRoles.id, { onDelete: "cascade" }),
  permissionId: integer("permission_id")
    .notNull()
    .references(() => permissions.id, { onDelete: "cascade" }),
}, (table) => ({
  rolePermissionUnique: unique("platform_role_permissions_role_permission_unique").on(table.roleId, table.permissionId),
}));

export const userPlatformRoles = pgTable("user_platform_roles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  roleId: integer("role_id")
    .notNull()
    .references(() => platformRoles.id, { onDelete: "cascade" }),
}, (table) => ({
  userRoleUnique: unique("user_platform_roles_user_role_unique").on(table.userId, table.roleId),
}));

export const platformAuditLog = pgTable("platform_audit_log", {
  id: serial("id").primaryKey(),
  actor: varchar("actor", { length: 255 }).notNull(),
  action: text("action").notNull(),
  target: text("target"),
  occurredAt: timestamp("occurred_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
});

export const supportCases = pgTable("support_cases", {
  id: serial("id").primaryKey(),
  reference: varchar("reference", { length: 64 }),
  customerName: varchar("customer_name", { length: 255 }).notNull(),
  subject: text("subject").notNull(),
  kind: varchar("kind", { length: 20 })
    .notNull()
    .default("bus")
    .$type<"bus" | "event" | "parcel">(),
  status: varchar("status", { length: 20 })
    .notNull()
    .default("open")
    .$type<"open" | "waiting" | "resolved">(),
  openedAt: timestamp("opened_at", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

/* ── Operational-table relations (subset used by queries) ── */
export const busRoutesRelations = relations(busRoutes, ({ one }) => ({
  operator: one(businessProfiles, {
    fields: [busRoutes.businessProfileId],
    references: [businessProfiles.id],
  }),
}));

export const parcelsRelations = relations(parcels, ({ one, many }) => ({
  operator: one(businessProfiles, {
    fields: [parcels.businessProfileId],
    references: [businessProfiles.id],
  }),
  courier: one(couriers, {
    fields: [parcels.courierId],
    references: [couriers.id],
  }),
  events: many(parcelEvents),
}));

export const parcelEventsRelations = relations(parcelEvents, ({ one }) => ({
  parcel: one(parcels, {
    fields: [parcelEvents.parcelId],
    references: [parcels.id],
  }),
}));

export const schedulesRelations = relations(schedules, ({ one }) => ({
  route: one(busRoutes, {
    fields: [schedules.routeId],
    references: [busRoutes.id],
  }),
  vehicle: one(vehicles, {
    fields: [schedules.vehicleId],
    references: [vehicles.id],
  }),
  driver: one(drivers, {
    fields: [schedules.driverId],
    references: [drivers.id],
  }),
}));

/* ── Operational-table types ── */
export type Country = typeof countries.$inferSelect;
export type BusRoute = typeof busRoutes.$inferSelect;
export type NewBusRoute = typeof busRoutes.$inferInsert;
export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;
export type BusBooking = typeof busBookings.$inferSelect;
export type Parcel = typeof parcels.$inferSelect;
export type ParcelEvent = typeof parcelEvents.$inferSelect;
export type Vehicle = typeof vehicles.$inferSelect;
export type Driver = typeof drivers.$inferSelect;
export type Schedule = typeof schedules.$inferSelect;
export type DriverAssignment = typeof driverAssignments.$inferSelect;
export type ScanEvent = typeof scanEvents.$inferSelect;
export type PosTransaction = typeof posTransactions.$inferSelect;
export type TillSession = typeof tillSessions.$inferSelect;
export type Courier = typeof couriers.$inferSelect;
export type ComplianceDocument = typeof complianceDocuments.$inferSelect;
export type Settlement = typeof settlements.$inferSelect;
export type CommissionRule = typeof commissionRules.$inferSelect;
export type ReconciliationFlag = typeof reconciliationFlags.$inferSelect;
export type KycReview = typeof kycReviews.$inferSelect;
export type Permission = typeof permissions.$inferSelect;
export type PlatformRole = typeof platformRoles.$inferSelect;
export type PlatformAuditEntry = typeof platformAuditLog.$inferSelect;
export type SupportCase = typeof supportCases.$inferSelect;