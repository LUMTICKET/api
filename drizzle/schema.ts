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

/* ── new KYB / business profile table ── */
export const businessProfiles = pgTable("business_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" })
    .unique(), // one profile per user
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

/* ── relations ── */
export const usersRelations = relations(users, ({ one }) => ({
  businessProfile: one(businessProfiles, {
    fields: [users.id],
    references: [businessProfiles.userId],
  }),
}));

export const businessProfilesRelations = relations(businessProfiles, ({ one }) => ({
  user: one(users, {
    fields: [businessProfiles.userId],
    references: [users.id],
  }),
}));

/* ── types ── */
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type BusinessProfile = typeof businessProfiles.$inferSelect;
export type NewBusinessProfile = typeof businessProfiles.$inferInsert;

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