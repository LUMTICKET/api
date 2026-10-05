# Lumticket API

Next.js App Router API for authentication, business verification profiles, team roles, team invitations, sessions, and audit logs.

## Requirements

- Node.js 20 or newer
- PostgreSQL database
- SMTP account for sending team invitations and two-factor login codes

## Setup

Install dependencies and create a `.env` file in the project root:

```bash
npm install
npm run dev
```

The deployed API base URL is `https://api-gamma-mocha-qn31xem8po.vercel.app`.

For local development, the API still runs at `http://localhost:3000` by default. Set `APP_URL` to the public API or web URL used in invitation links when deploying.

```env
DATABASE_URL="postgresql://user:password@host:5432/database?sslmode=require"
JWT_SECRET="replace-with-a-long-random-secret"
APP_URL="https://api-gamma-mocha-qn31xem8po.vercel.app"

# Gmail SMTP example. Use a Google App Password, not your normal password.
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=sender@example.com
SMTP_PASSWORD=your-google-app-password
SMTP_SECURE=false
FROM_EMAIL=Lum Team <sender@example.com>
```

For SMTP providers that require implicit TLS, use port `465` or set `SMTP_SECURE=true`. The database schema can be applied with:

```bash
npx drizzle-kit push
```

## Authentication

### Business types

`GET /api/business-types` is a public endpoint that lists the business types available for selection during **business registration** (the step after login credentials are created). The `business_types` table is seeded by default with Event Organizer, Bus Operator, Airline / Flight Operator, and Tourism / Tour Operator.

```bash
curl https://api-gamma-mocha-qn31xem8po.vercel.app/api/business-types
```

Response shape:

```json
{
  "businessTypes": [
    { "id": 1, "name": "Event Organizer", "slug": "event-organizer", "description": "Concerts, festivals, sports, and other live events" }
  ]
}
```

`businessType` values are accepted as an id (`1`), a slug (`"event-organizer"`), or a name (`"Event Organizer"`). Pass `?includeInactive=1` to include disabled types.

### Sign up (login credentials only)

`POST /api/auth/signup` creates the **login credentials only**: full name, a validated email address, an optional phone number, and a password. The business is *not* created here — business type selection happens in the next step (see [Register the business](#register-the-business-minimal-first-form)), so a long form never blocks account creation.

- `email` is required and must be a valid address (`400 "Enter a valid email address"` otherwise).
- `phone` is optional but must be a valid number when supplied; it becomes a login identifier alongside email and Business ID.
- `password` must be at least 8 characters.
- Every new account is issued a unique **Business ID** (`businessId`, e.g. `LMT-8F3K2QZ4`), another way to log in.

```bash
curl -X POST https://api-gamma-mocha-qn31xem8po.vercel.app/api/auth/signup \
  -H 'Content-Type: application/json' \
  -d '{"email":"owner@example.com","password":"Password123!","name":"Business Owner","country":"MW","phone":"+260991234567"}'
```

Supported signup country codes are `MW` (Malawi), `ZM` (Zambia), `ZW` (Zimbabwe), `MZ` (Mozambique), `TZ` (Tanzania), `ZA` (South Africa), `BW` (Botswana), and `NA` (Namibia). The `country` field is optional and is persisted on the user record when supplied.

The response includes `token`, `refreshToken`, `sessionId`, `expiresAt`, `refreshExpiresAt`, a `user` object (with `businessId`, `isInBusiness: false`, `role: null`) and `nextStep: "register-business"`, which tells the client to open the business registration form.

`businessType` is still accepted for legacy clients but is optional: it only stores a preference on the user record and never creates the business.

To change the stored business type later, call `PATCH /api/auth/signup` with a bearer token:

```bash
curl -X PATCH https://api-gamma-mocha-qn31xem8po.vercel.app/api/auth/signup \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{"businessType":"bus-operator"}'
```

### Register the business (minimal first form)

Business registration is a **separate step that runs after the login credentials exist**. The first form is deliberately minimal so users are not discouraged during onboarding; everything else is completed later from the dashboard.

`POST /api/business/register` requires only `businessType` and `businessName`:

```bash
curl -X POST https://api-gamma-mocha-qn31xem8po.vercel.app/api/business/register \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{"businessType":"event-organizer","businessName":"Lum Events"}'
```

Optional on this form: `type` (`individual` or `company`), `country`, `phone`, and `email` — the contact fields default to the owner's own account details when omitted.

On `201` the business profile is created with the KYB detail fields still empty, a pending `kyc_reviews` row is queued, and the account is linked to the business (`user.isInBusiness = true`, `user.businessProfileId = <profile id>`, `user.businessTypeId` set). The response contains the profile, `missingFields`, `nextStep: "complete-profile"`, and the updated `user`.

`GET /api/business/register` reports registration status so the dashboard can route the account:

- `{ "registered": false, "nextStep": "register-business" }`
- `{ "registered": true, "missingFields": ["address", ...], "nextStep": "complete-profile" }`
- `{ "registered": true, "missingFields": [], "nextStep": "dashboard" }`

The remaining business profile details are completed from the dashboard with the existing `PUT /api/kyb/:id`, which accepts any subset of `phone`, `address`, `city`, `country`, `website`, `description`, `executives`, `documents`, and keeps omitted fields unchanged. Registering twice returns `409` (with the existing `businessProfileId`).

### Log in

`POST /api/auth/login` accepts **a single identifier that can be a Business ID, an email address, or a phone number**, plus the password. `identifier` is the preferred key; the aliases `email`, `phone`, and `businessId` also work and resolve identically.

```bash
curl -X POST https://api-gamma-mocha-qn31xem8po.vercel.app/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"identifier":"owner@example.com","password":"Password123!"}'

# or: {"identifier":"LMT-8F3K2QZ4","password":"Password123!"}
# or: {"identifier":"+260991234567","password":"Password123!"}
```

Two-factor authentication is enabled by default (`users.two_factor_enabled`), so a correct password alone does **not** create a session. Instead the response starts the second factor:

```json
{
  "requires2FA": true,
  "userId": 12,
  "challengeToken": "9f2c…",
  "channel": "email",
  "delivery": "sent",
  "expiresIn": 600,
  "maskedDestination": "o***@example.com"
}
```

Accounts with `twoFactorEnabled: false` skip the challenge and receive `token`, `refreshToken`, `sessionId`, `user`, and `nextStep` immediately. Unknown identifiers and wrong passwords both return `401 Invalid credentials`.

### Two-factor verification

`POST /api/auth/2fa` exchanges the 6-digit code emailed to the account address for the session:

```bash
curl -X POST https://api-gamma-mocha-qn31xem8po.vercel.app/api/auth/2fa \
  -H 'Content-Type: application/json' \
  -d '{"challengeToken":"<token-from-login>","code":"123456"}'
```

On success it returns the same payload as a direct login (`token`, `refreshToken`, `sessionId`, `expiresAt`, `refreshExpiresAt`, `user`, `nextStep`). An incorrect code returns `401`; after 5 failed attempts the challenge is invalidated and returns `429`; an expired challenge returns `410`. Codes live for 10 minutes.

`POST /api/auth/2fa/resend` with `{ "challengeToken": "…" }` emails a fresh code and keeps the same token so the client does not need to restart the login.

Google sign-in does not use this flow — Google enforces its own second factor.

### Continue with Google

`POST /api/auth/google` accepts the Google `idToken` plus `email`, `name`, and `avatar`. The email is validated before the account is created. `businessType` is optional: the business is registered in its own step afterwards, exactly like a password account.

```bash
curl -X POST https://api-gamma-mocha-qn31xem8po.vercel.app/api/auth/google \
  -H 'Content-Type: application/json' \
  -d '{"idToken":"<google-id-token>","email":"owner@example.com","name":"Business Owner"}'
```

New Google accounts return `nextStep: "register-business"` (or `"dashboard"` for returning users who already belong to a business) and `isNewAccount: true` on creation.

For protected endpoints, send the access token as a bearer token:

```http
Authorization: Bearer <token>
```

### Current user

`GET /api/auth/me` returns the authenticated account together with its identity — login identifiers, business linkage, and the role it signs in with:

```json
{
  "id": 12,
  "email": "owner@example.com",
  "phone": "+260991234567",
  "businessId": "LMT-8F3K2QZ4",
  "isInBusiness": true,
  "businessProfileId": 1,
  "businessName": "Lum Events",
  "role": "owner",
  "permissions": ["*"],
  "twoFactorEnabled": true,
  "businessType": { "id": 1, "name": "Event Organizer", "slug": "event-organizer" }
}
```

```bash
curl https://api-gamma-mocha-qn31xem8po.vercel.app/api/auth/me \
  -H 'Authorization: Bearer <token>'
```

### Login identity fields

Every auth response's `user` object shares the same identity shape, backed by the `users` table columns added in `drizzle/migrations/0007_auth_identity_business_flow.sql`:

| Field | Meaning |
| --- | --- |
| `businessId` | Unique per-account Business ID (e.g. `LMT-8F3K2QZ4`); a login identifier |
| `phone` | Optional second login identifier |
| `isInBusiness` | `true` once the account owns or has joined a business |
| `businessProfileId` | Which business the account operates inside |
| `role` | `owner`, or the invited team role (`admin` / `operator` / `viewer`) — `null` before a business exists |
| `permissions` | `"*"` for owners, otherwise the custom `team_roles.permissions` of the member's role |
| `twoFactorEnabled` | Whether password logins require the emailed second factor |

### Refresh a session

`POST /api/auth/refresh` rotates the refresh token and returns a new access token. Replace the stored refresh token with the returned one.

```bash
curl -X POST https://api-gamma-mocha-qn31xem8po.vercel.app/api/auth/refresh \
  -H 'Content-Type: application/json' \
  -d '{"refreshToken":"<refresh-token>"}'
```

Sessions expire after 24 hours. Refresh tokens are rotated and have their own expiry. A revoked or expired session returns `401 Unauthorized`.

### Log out

`POST /api/auth/logout` revokes the current database session.

```bash
curl -X POST https://api-gamma-mocha-qn31xem8po.vercel.app/api/auth/logout \
  -H 'Authorization: Bearer <token>'
```

## Business profile (KYB)

All KYB endpoints require authentication and are restricted to the current user's own business profile.

### Create a profile

`POST /api/kyb` is the full KYB form and requires `businessName`, `email`, `phone`, `address`, `city`, and `country` (`email` is validated). It is an alternative to the minimal `POST /api/business/register` flow: use it when the client collects everything in one shot. Either way the account is linked to the created business (`isInBusiness: true`, `businessProfileId`).

```bash
curl -X POST https://api-gamma-mocha-qn31xem8po.vercel.app/api/kyb \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{
    "businessName":"Example Business",
    "email":"business@example.com",
    "phone":"+260971234567",
    "address":"123 Main Street",
    "city":"Lusaka",
    "country":"ZM",
    "type":"company",
    "website":"https://example.com",
    "description":"Business description"
  }'
```

The response contains the profile `id`. Save it as `businessProfileId` for team and audit requests.

### Read the current profile

`GET /api/kyb` returns the authenticated user's profile.

```bash
curl https://api-gamma-mocha-qn31xem8po.vercel.app/api/kyb \
  -H 'Authorization: Bearer <token>'
```

### Read, update, or delete a profile

Use `GET`, `PUT`, or `DELETE /api/kyb/:id`. `PUT` accepts any profile fields and keeps omitted fields unchanged.

```bash
curl -X PUT https://api-gamma-mocha-qn31xem8po.vercel.app/api/kyb/<business-profile-id> \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{"description":"Updated business description"}'
```

## Payments and events

Event publishing requires a successful payment belonging to the same authenticated user and business profile. The current payment provider is intentionally a simulation so the Expo flow can be integrated before a mobile-money or card provider is connected.

### Simulate the event publishing payment

`POST /api/payments/simulate` creates a successful payment record. Amounts are integer minor units; for MWK, send the amount as whole kwacha.

```bash
curl -X POST https://api-gamma-mocha-qn31xem8po.vercel.app/api/payments/simulate \
  -H 'Authorization: Bearer <owner-token>' \
  -H 'Content-Type: application/json' \
  -d '{
    "businessProfileId": 1,
    "amount": 10000,
    "currency":"MWK",
    "method":"tnm"
  }'
```

Supported methods are `card`, `tnm`, and `airtel`. Save the returned payment `id` as `paymentId`.

### Create an event and ticket types

`POST /api/events` requires the business profile owner and a successful `paymentId`. Supported categories are `event`, `bus`, `flight`, and `tourism`. The API accepts `tickets`; the Expo form uses `tiers`, which must be mapped before sending.

```bash
curl -X POST https://api-gamma-mocha-qn31xem8po.vercel.app/api/events \
  -H 'Authorization: Bearer <owner-token>' \
  -H 'Content-Type: application/json' \
  -d '{
    "businessProfileId": 1,
    "paymentId": 1,
    "title":"Lilongwe Food Fest",
    "subtitle":"Food, music, and local makers",
    "category":"event",
    "organizer":"Lum Events",
    "description":"An open-air food festival.",
    "location":"Lilongwe Civic Centre",
    "startsAt":"2026-09-20T14:00:00.000Z",
    "maxPerUser":5,
    "tags":["food","music"],
    "tickets":[
      {"name":"General Admission","price":25000,"currency":"MWK","capacity":500,"perks":["Entry"]},
      {"name":"VIP","price":75000,"currency":"MWK","capacity":50,"perks":["Priority entry","Reserved seating"]}
    ]
  }'
```

The API creates the event and all ticket types in one transaction. Each ticket type starts with `remaining` equal to `capacity`. The event creator, business profile, and payment are linked in the database, and event creation is added to the audit log.

### Read and edit an event

`GET /api/events/:id` returns an event and its ticket types. `PUT /api/events/:id` allows the business owner or an accepted team member with the `admin` role to edit the event. Send only the fields that should change. Include `tickets` or `tiers` when replacing all ticket types; omitted ticket arrays leave existing ticket types unchanged.

```bash
curl -X PUT https://api-gamma-mocha-qn31xem8po.vercel.app/api/events/1 \
  -H 'Authorization: Bearer <owner-or-admin-token>' \
  -H 'Content-Type: application/json' \
  -d '{
    "category":"bus",
    "title":"Blantyre to Mzuzu Express",
    "location":"Blantyre Bus Terminal",
    "startsAt":"2026-09-25T06:00:00.000Z",
    "tickets":[
      {"name":"Standard Seat","price":15000,"currency":"MWK","capacity":40,"perks":["Luggage"]}
    ]
  }'
```

Ticket types are normalized under the event and can represent tickets for all four categories. For bus and flight products, use ticket names such as `Standard Seat` or `Economy`; for tourism, use names such as `Day Pass`; for events, use names such as `General Admission` or `VIP`.

The update is transactional: event changes and ticket replacement either both succeed or neither is committed. Every update is written to the audit log with the acting user's ID. A team member must be accepted into the business and have `role: "admin"`; an invitation alone does not grant edit access.

### List events and payments

```bash
curl 'https://api-gamma-mocha-qn31xem8po.vercel.app/api/events?businessProfileId=1' \
  -H 'Authorization: Bearer <owner-token>'

curl 'https://api-gamma-mocha-qn31xem8po.vercel.app/api/payments/simulate?businessProfileId=1' \
  -H 'Authorization: Bearer <owner-token>'
```

### Expo integration sequence

After the owner submits the create form:

1. Call `POST /api/payments/simulate` with the selected payment method and platform fee.
2. Read the returned payment `id`.
3. Call `POST /api/events` with that `paymentId` and map each Expo tier to a ticket: `name`, numeric `price`, `currency`, `perks` array, and numeric `capacity` from `remaining`.
4. Show the success screen only after the event request returns `201`.

Example client helper:

```ts
const API_URL = "https://api-gamma-mocha-qn31xem8po.vercel.app";

async function publishEvent(token: string, businessProfileId: number, payload: any, method: "card" | "tnm" | "airtel") {
  const paymentResponse = await fetch(`${API_URL}/api/payments/simulate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ businessProfileId, amount: 10000, currency: "MWK", method }),
  });
  if (!paymentResponse.ok) throw new Error("Payment simulation failed");
  const payment = await paymentResponse.json();

  const eventResponse = await fetch(`${API_URL}/api/events`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      ...payload,
      businessProfileId,
      paymentId: payment.id,
      startsAt: payload.date,
      tickets: payload.tiers.map((tier: { name: string; price: string; currency?: string; perks: string; remaining: string }) => ({
        name: tier.name,
        price: Number(tier.price),
        currency: tier.currency || "MWK",
        perks: tier.perks.split(",").map((perk) => perk.trim()).filter(Boolean),
        capacity: Number(tier.remaining),
      })),
    }),
  });
  if (!eventResponse.ok) throw new Error("Event creation failed");
  return eventResponse.json();
}
```

## Operational API (catalog, bookings, fleet, POS, finance, admin)

The operational tables (see `drizzle/migrations/0006_operational_tables.sql`) are bootstrapped
idempotently at request time, so no manual migration step is required on a fresh database.
Monetary amounts are integer minor units and default to `MWK` unless a `currency` is supplied.
All authenticated endpoints use the same bearer token as the rest of the API.

### Public catalog & discovery

- `GET /api/countries` — seeded country list (code, name, currency, flag, `live` flag).
- `GET /api/catalog/routes?origin=&destination=&q=` — published bus routes with the operator
  business name, `fromPrice`, duration, rating, and departures per day.
- `GET /api/catalog/events?country=&q=` — published, on-sale events across all operators with
  derived `status` (`on-sale` / `selling-fast` / `sold-out`) and `fromPrice`.

### Customer bookings & parcels

- `GET /api/bookings` — the authenticated customer's bookings (kind `bus` | `event` | `parcel`).
- `POST /api/bookings` — create a booking ({kind, title, scheduledFor, amount, ...}); the
  `LMT-` reference is generated automatically.
- `GET /api/bookings/:reference` — one owned booking by reference.
- `POST /api/parcels` — send a parcel ({senderName, recipientName, origin, destination,
  weightKg?, courierId?}); cost defaults to base fee + per-kg and the first tracking event is
  written.
- `GET /api/parcels/:reference/tracking` — public tracking timeline (recipient names masked for
  non-owners).

### Operator operations (owned business profile)

All operator endpoints resolve the caller's business profile automatically; a missing profile
returns `404`.

- `/api/bus-bookings` — `GET` list, `POST` create ({scheduleId?, customerName, seats[], amount,
  channel `online|pos`, status `confirmed|checked-in|cancelled`}), `PUT ?id=`, `DELETE ?id=`.
  Confirmed bookings bump the schedule's `seats_sold`; overbooking returns `409`.
- `/api/fleet` — vehicles CRUD (plate, type, capacity, status, roadworthy expiry).
- `/api/schedules` — departures CRUD joined with route/vehicle/driver; `PUT` moves status
  through `scheduled → boarding → departed → completed`.
- `/api/drivers` — driver roster CRUD; `/api/assignments` — driver assignments CRUD
  ({driverId required, vehicleId?, scheduleId?, passengerCount, parcelCount, status
  `upcoming|in-progress|completed`}).
- `/api/couriers` — courier roster CRUD; `GET` derives `activeParcels` per courier; deletion
  detaches their parcels instead of dropping history.
- `/api/compliance` — compliance documents CRUD ({subject, kind, expiresAt, documentUrl?});
  `GET` computes `daysLeft` per document.
- `/api/validations` — `POST` resolves a scanned code ({code, kind `ticket|parcel`, mode
  `auto|manual`, device?, synced?, occurredAt?}) against parcels/tickets and records
  `valid | invalid | duplicate`; `GET` returns the scan log. Offline scans can be replayed with
  `synced: false` and their original `occurredAt`.
- `/api/pos/transactions` — `GET` agent transactions, `POST` record a sale ({kind
  `bus-ticket|parcel|event-ticket`, amount, method `cash|mobile-money`, reference?}).
- `/api/pos/tills` — `POST` open a till ({openingFloat, limitAmount?}; `409` if one is already
  open), `GET` current open till + today's cash/mobile totals + history, `PUT ?id=` closes the
  till and stores the totals computed from its transactions.

### Finance

- `GET /api/finance/settlements?status=pending|paid` — settlements for the owned profile
  (period, gross/commission/net amounts, `paidAt` when settled).

### Platform administration

Admin endpoints require a platform role via `user_platform_roles`. On a fresh install (no roles
assigned yet) any authenticated user passes so the endpoints are usable out of the box; assign
roles and set `ADMIN_STRICT=1` to lock this down. Every admin mutation writes to the platform
audit log.

- `GET /api/admin/commission` / `PUT /api/admin/commission` — commission rules per service
  (`bus`, `events`, `parcels`, `agent`, `gateway`); `PUT {service, rate}` upserts and audits.
- `GET /api/admin/kyc` — KYC review queue joined with business profiles. `POST /api/admin/kyc`
  decides ({id, status `approved|rejected|re-verification`, riskTier?}); approving also sets
  `business_profiles.is_verified`.
- `GET /api/admin/operators` — operators & agents directory (type, country, commission rate,
  account status). `PATCH /api/admin/operators?id=<profileId>` sets {accountStatus
  `active|suspended`}.
- `/api/admin/reconciliation` — `GET` flags, `POST {gatewayRef, amount?, currency?, issue?}`
  create, `PATCH ?id=` resolves {status `auto-refunded|booking-completed|needs-review`}.
- `GET /api/admin/platform-audit` — platform-level audit trail (actor, action, target).
- `/api/admin/support-cases` — `GET` list with `?status=`/`?kind=` filters, `POST
  {customerName, subject, reference?, kind?}`, `PATCH ?id=` moves {status
  `open|waiting|resolved`}.
- `/api/admin/roles` — `GET` roles with permission keys + the full permission list, `POST`
  create role ({name, scope `platform|operator|field`, permissions?}), `PUT ?name=<role>`
  replaces the role's permission set ({permissions: ["manage-commission", ...]}).

### KYB integration

`POST /api/kyb` now also seeds a pending `kyc_reviews` row for the created profile, so new
businesses appear in the platform KYC queue immediately. `POST`/`PUT /api/events` accept the
catalog fields `venue`, `city`, and `countryCode` used by the public events listing.

## Team roles

Only the business profile owner can create or list roles.

Team members sign in through the **same** `POST /api/auth/login` endpoint as
the owner (with their Business ID, email, or phone, plus the two-factor code).
After sign-in their `user.role` and `user.permissions` come from the
`team_members` row created when the invitation was accepted, and
`user.isInBusiness` / `user.businessProfileId` identify which business they
operate inside.

### Create a role

`POST /api/team/roles`:

```bash
curl -X POST https://api-gamma-mocha-qn31xem8po.vercel.app/api/team/roles \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{
    "businessProfileId": 1,
    "name":"Project Admin",
    "description":"Can manage project staff",
    "permissions":["read","write","invite"]
  }'
```

The response contains the role `id`, which can be supplied as `roleId` when creating an invitation. Role creation creates an audit event.

### List roles

`GET /api/team/roles?businessProfileId=<id>` returns roles for the owned business profile.

```bash
curl 'https://api-gamma-mocha-qn31xem8po.vercel.app/api/team/roles?businessProfileId=1' \
  -H 'Authorization: Bearer <token>'
```

## Team invitations

### Send an invitation

`POST /api/team/invitations` creates a pending invitation and sends an email through the configured SMTP account. The owner must provide `businessProfileId`, `email`, and `name`. `roleId` is optional; `role` can be used as a fallback role name. Invitations expire after seven days by default.

```bash
curl -X POST https://api-gamma-mocha-qn31xem8po.vercel.app/api/team/invitations \
  -H 'Authorization: Bearer <owner-token>' \
  -H 'Content-Type: application/json' \
  -d '{
    "businessProfileId": 1,
    "email":"member@example.com",
    "name":"Team Member",
    "roleId": 1,
    "expiresInDays": 7
  }'
```

The invitation is stored in the database before email delivery and the action is written to the audit log. The `email` must be a valid address (`400` otherwise) because it becomes the invited person's login identifier. A successful `201` response means the invitation record was created; check the server log if the SMTP provider rejects delivery.

### List invitations

`GET /api/team/invitations?businessProfileId=<id>` lists invitations for the owned profile.

```bash
curl 'https://api-gamma-mocha-qn31xem8po.vercel.app/api/team/invitations?businessProfileId=1' \
  -H 'Authorization: Bearer <owner-token>'
```

### Preview an invitation

`GET /api/team/invitations/:token` is public and validates that the invitation exists, is pending, and has not expired.

```bash
curl https://api-gamma-mocha-qn31xem8po.vercel.app/api/team/invitations/<invitation-token>
```

### Accept an invitation (creates the member's login credentials)

`POST /api/team/invitations/:token` can now mint credentials in the `users`
table at approval time — the invited person does not need an account
beforehand:

```bash
curl -X POST https://api-gamma-mocha-qn31xem8po.vercel.app/api/team/invitations/<invitation-token> \
  -H 'Content-Type: application/json' \
  -d '{"password":"Password123!","phone":"+260991234567"}'
```

No bearer token is required — the emailed token is the secret. On success
(`201`) the endpoint:

1. validates the invitation's email and creates the account in `users` with a
   hashed password, a fresh Business ID, and an optional phone identifier;
2. links the account to the business (`isInBusiness: true`,
   `businessProfileId` set);
3. records the `team_members` row carrying the invited `role` / `roleId` and
   marks the invitation accepted;
4. writes the audit event and returns a full session (`token`,
   `refreshToken`, …) with `user.role` and `user.permissions`, so the new
   member lands on the dashboard already signed in with their role.

If an account with that email already exists, the endpoint returns `409` and
the person can accept while signed in (legacy flow).

Legacy flow: the invited person signs up or logs in first, then calls
`POST /api/team/invitations/:token` with their access token and **no**
`password` in the body. This also links their account to the business
(`isInBusiness: true`, `businessProfileId`).

An expired invitation returns `410`. A user who already belongs to a team returns `409`.

## Audit logs

`GET /api/audit?businessProfileId=<id>` returns audit events for an owned business profile in creation order.

```bash
curl 'https://api-gamma-mocha-qn31xem8po.vercel.app/api/audit?businessProfileId=1' \
  -H 'Authorization: Bearer <owner-token>'
```

Audit records include the actor, business profile, affected resource, action, details, and timestamp. Team role creation, invitation creation, and invitation acceptance are currently recorded.

## Common errors

| Status | Meaning |
| --- | --- |
| `400` | Required input is missing or invalid (including an invalid email) |
| `401` | Access token or credentials are missing, invalid, expired, or revoked |
| `404` | Resource does not exist or is not owned by the authenticated user |
| `409` | Duplicate account or the user already belongs to a team |
| `410` | Invitation or two-factor challenge has expired |
| `429` | Too many incorrect two-factor codes; start login again |
| `500` | Unexpected server or database error |
| `502` | The two-factor email could not be delivered (production) |

## Validation

Run the project checks before deployment:

```bash
npm run lint
npm run build
```
