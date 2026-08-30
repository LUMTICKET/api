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

The API runs at `http://localhost:3000` by default. Set `APP_URL` to the public API or web URL used in invitation links when deploying.

```env
DATABASE_URL="postgresql://user:password@host:5432/database?sslmode=require"
JWT_SECRET="replace-with-a-long-random-secret"
APP_URL="http://localhost:3000"

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

### Sign up

`POST /api/auth/signup` creates a user and a database-backed session.

```bash
curl -X POST http://localhost:3000/api/auth/signup \
  -H 'Content-Type: application/json' \
  -d '{"email":"owner@example.com","password":"Password123!","name":"Business Owner"}'
```

The response includes `token`, `refreshToken`, `sessionId`, `expiresAt`, and `refreshExpiresAt`. Keep the access token and refresh token secure.

### Log in

`POST /api/auth/login` accepts the same email and password and returns a new session.

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"owner@example.com","password":"Password123!"}'
```

For protected endpoints, send the access token as a bearer token:

```http
Authorization: Bearer <token>
```

### Current user

`GET /api/auth/me` returns the authenticated user.

```bash
curl http://localhost:3000/api/auth/me \
  -H 'Authorization: Bearer <token>'
```

### Refresh a session

`POST /api/auth/refresh` rotates the refresh token and returns a new access token. Replace the stored refresh token with the returned one.

```bash
curl -X POST http://localhost:3000/api/auth/refresh \
  -H 'Content-Type: application/json' \
  -d '{"refreshToken":"<refresh-token>"}'
```

Sessions expire after 24 hours. Refresh tokens are rotated and have their own expiry. A revoked or expired session returns `401 Unauthorized`.

### Log out

`POST /api/auth/logout` revokes the current database session.

```bash
curl -X POST http://localhost:3000/api/auth/logout \
  -H 'Authorization: Bearer <token>'
```

## Business profile (KYB)

All KYB endpoints require authentication and are restricted to the current user's own business profile.

### Create a profile

`POST /api/kyb` requires `businessName`, `email`, `phone`, `address`, `city`, and `country`.

```bash
curl -X POST http://localhost:3000/api/kyb \
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
curl http://localhost:3000/api/kyb \
  -H 'Authorization: Bearer <token>'
```

### Read, update, or delete a profile

Use `GET`, `PUT`, or `DELETE /api/kyb/:id`. `PUT` accepts any profile fields and keeps omitted fields unchanged.

```bash
curl -X PUT http://localhost:3000/api/kyb/<business-profile-id> \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{"description":"Updated business description"}'
```

## Payments and events

Event publishing requires a successful payment belonging to the same authenticated user and business profile. The current payment provider is intentionally a simulation so the Expo flow can be integrated before a mobile-money or card provider is connected.

### Simulate the event publishing payment

`POST /api/payments/simulate` creates a successful payment record. Amounts are integer minor units; for MWK, send the amount as whole kwacha.

```bash
curl -X POST http://localhost:3000/api/payments/simulate \
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

`POST /api/events` requires the business profile owner and a successful `paymentId`. The API accepts `tickets`; the Expo form uses `tiers`, which must be mapped before sending.

```bash
curl -X POST http://localhost:3000/api/events \
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

### List events and payments

```bash
curl 'http://localhost:3000/api/events?businessProfileId=1' \
  -H 'Authorization: Bearer <owner-token>'

curl 'http://localhost:3000/api/payments/simulate?businessProfileId=1' \
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
const API_URL = "http://localhost:3000";

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

## Team roles

Only the business profile owner can create or list roles.

### Create a role

`POST /api/team/roles`:

```bash
curl -X POST http://localhost:3000/api/team/roles \
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
curl 'http://localhost:3000/api/team/roles?businessProfileId=1' \
  -H 'Authorization: Bearer <token>'
```

## Team invitations

### Send an invitation

`POST /api/team/invitations` creates a pending invitation and sends an email through the configured SMTP account. The owner must provide `businessProfileId`, `email`, and `name`. `roleId` is optional; `role` can be used as a fallback role name. Invitations expire after seven days by default.

```bash
curl -X POST http://localhost:3000/api/team/invitations \
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
curl 'http://localhost:3000/api/team/invitations?businessProfileId=1' \
  -H 'Authorization: Bearer <owner-token>'
```

### Preview an invitation

`GET /api/team/invitations/:token` is public and validates that the invitation exists, is pending, and has not expired.

```bash
curl http://localhost:3000/api/team/invitations/<invitation-token>
```

### Accept an invitation

The invited person must first sign up or log in, then call `POST /api/team/invitations/:token` with their access token. This creates a `teamMembers` record, marks the invitation as accepted, and creates an audit event.

```bash
curl -X POST http://localhost:3000/api/team/invitations/<invitation-token> \
  -H 'Authorization: Bearer <invited-user-token>'
```

An expired invitation returns `410`. A user who already belongs to a team returns `409`.

## Audit logs

`GET /api/audit?businessProfileId=<id>` returns audit events for an owned business profile in creation order.

```bash
curl 'http://localhost:3000/api/audit?businessProfileId=1' \
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
