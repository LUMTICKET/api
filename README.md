# Lumticket API

Next.js App Router API for authentication, business verification profiles, team roles, team invitations, sessions, and audit logs.

## Requirements

- Node.js 20 or newer
- PostgreSQL database
- SMTP account for sending team invitations

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

`GET /api/business-types` is a public endpoint that lists the business types available for selection during signup and first-time Google sign-in. The `business_types` table is seeded by default with Event Organizer, Bus Operator, Airline / Flight Operator, and Tourism / Tour Operator.

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

### Sign up

`POST /api/auth/signup` creates a user and a database-backed session. The signup form accepts a full name, country, email or mobile identifier, password, and the selected business type. The identifier is stored in the user's existing `email` field.

```bash
curl -X POST https://api-gamma-mocha-qn31xem8po.vercel.app/api/auth/signup \
  -H 'Content-Type: application/json' \
  -d '{"email":"owner@example.com","password":"Password123!","name":"Business Owner","country":"MW","businessType":"event-organizer"}'
```

Supported signup country codes are `MW` (Malawi), `ZM` (Zambia), `ZW` (Zimbabwe), `MZ` (Mozambique), `TZ` (Tanzania), `ZA` (South Africa), `BW` (Botswana), and `NA` (Namibia). The `country` field is optional for existing clients and is persisted on the user record when supplied.

The `businessType` field is required and must match one of the seeded types from `GET /api/business-types`. It is stored on the user record via `business_type_id`.

The response includes `token`, `refreshToken`, `sessionId`, `expiresAt`, `refreshExpiresAt`, and a `user` object containing the selected `businessType`.

To change the business type later, call `PATCH /api/auth/signup` with a bearer token:

```bash
curl -X PATCH https://api-gamma-mocha-qn31xem8po.vercel.app/api/auth/signup \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{"businessType":"bus-operator"}'
```

### Log in

`POST /api/auth/login` accepts the same email and password and returns a new session. The response's `user` object includes the stored `businessType`.

```bash
curl -X POST https://api-gamma-mocha-qn31xem8po.vercel.app/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"owner@example.com","password":"Password123!"}'
```

### Continue with Google

`POST /api/auth/google` accepts the Google `idToken` plus `email`, `name`, and `avatar`. On **first-time** Google sign-in (new account), the request must also include `businessType` — the selected business type is stored on the new user. For returning Google users the business type is already known, so `businessType` is optional; when supplied it updates the stored value.

```bash
curl -X POST https://api-gamma-mocha-qn31xem8po.vercel.app/api/auth/google \
  -H 'Content-Type: application/json' \
  -d '{"idToken":"<google-id-token>","email":"owner@example.com","name":"Business Owner","businessType":"event-organizer"}'
```

The response's `user` object always includes the linked `businessType`.

For protected endpoints, send the access token as a bearer token:

```http
Authorization: Bearer <token>
```

### Current user

`GET /api/auth/me` returns the authenticated user, including the linked `businessType`.

```bash
curl https://api-gamma-mocha-qn31xem8po.vercel.app/api/auth/me \
  -H 'Authorization: Bearer <token>'
```

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

`POST /api/kyb` requires `businessName`, `email`, `phone`, `address`, `city`, and `country`.

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

The invitation is stored in the database before email delivery and the action is written to the audit log. A successful `201` response means the invitation record was created; check the server log if the SMTP provider rejects delivery.

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

### Accept an invitation

The invited person must first sign up or log in, then call `POST /api/team/invitations/:token` with their access token. This creates a `teamMembers` record, marks the invitation as accepted, and creates an audit event.

```bash
curl -X POST https://api-gamma-mocha-qn31xem8po.vercel.app/api/team/invitations/<invitation-token> \
  -H 'Authorization: Bearer <invited-user-token>'
```

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
| `400` | Required input is missing or invalid |
| `401` | Access token is missing, invalid, expired, or revoked |
| `404` | Resource does not exist or is not owned by the authenticated user |
| `409` | Duplicate account or the user already belongs to a team |
| `410` | Invitation has expired |
| `500` | Unexpected server or database error |

## Validation

Run the project checks before deployment:

```bash
npm run lint
npm run build
```
