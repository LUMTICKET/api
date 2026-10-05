# Lumticket API

Next.js App Router API for authentication, business verification profiles, team roles, team invitations, sessions, audit logs, and the full operational surface (catalog, bookings, parcels, fleet, dispatch, POS, finance, and platform administration).

- [Frontend quick start](#frontend-quick-start) — base URL, CORS, and the complete endpoint index
- [Wiring the frontend](#wiring-the-frontend) — typed client, sign-in/2FA, `nextStep` routing, screen-to-endpoint map
- [Authentication](#authentication) — signup, login, two-factor, Google, sessions
- [Business profile (KYB)](#business-profile-kyb), [Payments and events](#payments-and-events)
- [Operational API](#operational-api-catalog-bookings-fleet-pos-finance-admin), [Team](#team-roles), [Audit logs](#audit-logs)

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

## Frontend quick start

- **Base URL (production):** `https://api-gamma-mocha-qn31xem8po.vercel.app`
- **Base URL (local API):** `http://localhost:3000`
- **Transport:** JSON request and response bodies. Send `Content-Type: application/json`
  with any request that has a body.
- **Auth:** every protected route expects `Authorization: Bearer <access token>`.
- **CORS:** `middleware.ts` allows `https://lumticket.vercel.app`,
  `https://lumiticketui.vercel.app`, `https://luticketnewui.vercel.app`,
  `http://localhost:8081` (Expo), `http://localhost:19006`, and any
  `https://localhost*` origin. Add your web client's origin there before shipping it.
- **Sessions:** access tokens last 24 hours, refresh tokens 7 days and are rotated on
  every use.
- **Money:** every `amount` is an integer in minor units and defaults to `MWK` unless a
  `currency` is supplied.

### Complete endpoint index

`Public` = no token required, `Bearer` = access token required,
`Platform` = authenticated user holding a platform role (see
[Platform administration](#platform-administration)).

#### Authentication and identity

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/auth/signup` | Public | Create login credentials only; returns `nextStep: "register-business"` |
| `PATCH` | `/api/auth/signup` | Bearer | Change the account's stored business type |
| `POST` | `/api/auth/login` | Public | Identifier (Business ID / email / phone) + password; starts the 2FA challenge |
| `POST` | `/api/auth/2fa` | Public | Exchange `challengeToken` + 6-digit `code` for a session |
| `POST` | `/api/auth/2fa/resend` | Public | Email a fresh code, keeping the same challenge token |
| `POST` | `/api/auth/google` | Public | Google `idToken` sign-in (no API-side 2FA) |
| `POST` | `/api/auth/refresh` | Public | Rotate the refresh token, return a new access token |
| `POST` | `/api/auth/logout` | Bearer | Revoke the current session |
| `GET` | `/api/auth/me` | Bearer | Identity, business linkage, role and permissions |
| `GET` | `/api/business-types` | Public | Business types shown on the registration form |

#### Onboarding and business profile (KYB)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/business/register` | Bearer | Minimal business registration (`businessType`, `businessName`) |
| `GET` | `/api/business/register` | Bearer | Registration status: `registered`, `missingFields`, `nextStep` |
| `POST` | `/api/kyb` | Bearer | Full KYB form in one shot |
| `GET` | `/api/kyb` | Bearer | The caller's own profile |
| `GET` | `/api/kyb/:id` | Bearer | Owned profile by id |
| `PUT` | `/api/kyb/:id` | Bearer | Partial profile update (omitted fields are kept) |
| `DELETE` | `/api/kyb/:id` | Bearer | Delete the owned profile |

#### Public catalog and customers

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/countries` | Public | Supported countries with currency and live flag |
| `GET` | `/api/catalog/routes` | Public | Bus route search (`origin`, `destination`, `q`) |
| `GET` | `/api/catalog/events` | Public | Published events with `fromPrice` and derived `status` |
| `GET` | `/api/bookings` | Bearer | The caller's bookings (all kinds) |
| `POST` | `/api/bookings` | Bearer | Record a booking (`kind`, `title`, `scheduledFor`) |
| `GET` | `/api/bookings/:reference` | Bearer | One owned booking by `LMT-…` reference |
| `GET` | `/api/parcels` | Bearer | Courier operator parcel queue |
| `POST` | `/api/parcels` | Bearer | Send a parcel (auto-priced from weight) |
| `GET` | `/api/parcels/:reference/tracking` | Public | Tracking timeline; names masked for non-owners |

#### Operator operations (own business profile)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` `POST` | `/api/bus-bookings` | Bearer | List / create bus bookings (seat inventory enforced) |
| `PUT` `DELETE` | `/api/bus-bookings?id=` | Bearer | Update / remove a booking |
| `GET` `POST` | `/api/fleet` | Bearer | Vehicles list / create (`plate` required) |
| `PUT` `DELETE` | `/api/fleet?id=` | Bearer | Update / remove a vehicle |
| `GET` `POST` | `/api/schedules` | Bearer | Departures list / create (`routeId`, `departureAt`) |
| `PUT` `DELETE` | `/api/schedules?id=` | Bearer | Update (status, seats) / remove a departure |
| `GET` `POST` | `/api/drivers` | Bearer | Driver roster |
| `PUT` `DELETE` | `/api/drivers?id=` | Bearer | Update / remove a driver |
| `GET` `POST` | `/api/assignments` | Bearer | Driver assignments (`driverId` required) |
| `PUT` `DELETE` | `/api/assignments?id=` | Bearer | Update / remove an assignment |
| `GET` `POST` | `/api/couriers` | Bearer | Courier roster with derived `activeParcels` |
| `PUT` `DELETE` | `/api/couriers?id=` | Bearer | Update / remove a courier (parcels are detached) |
| `GET` `POST` | `/api/compliance` | Bearer | Compliance documents (`expiresAt` required) |
| `PUT` `DELETE` | `/api/compliance?id=` | Bearer | Update / remove a document |
| `POST` | `/api/validations` | Bearer | Resolve a scanned code and log `valid`/`invalid`/`duplicate` |
| `GET` | `/api/validations` | Bearer | Scan log, newest first |
| `GET` `POST` | `/api/pos/transactions` | Bearer | Agent POS sales |
| `POST` | `/api/pos/tills` | Bearer | Open a till (`409` if one is already open) |
| `GET` | `/api/pos/tills` | Bearer | Open till + today's cash/mobile totals + history |
| `PUT` | `/api/pos/tills?id=` | Bearer | Close the till and store its totals |

#### Payments, events, finance

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/payments/simulate` | Bearer | Create a succeeded payment (`card`/`tnm`/`airtel`) |
| `GET` | `/api/payments/simulate?businessProfileId=` | Bearer | Payments for an owned profile |
| `POST` | `/api/events` | Bearer | Publish an event + ticket types (needs a succeeded `paymentId`) |
| `GET` | `/api/events?businessProfileId=` | Bearer | Events for an owned profile |
| `GET` | `/api/events/:id` | Bearer | Event with its ticket types (owner or team `admin`) |
| `PUT` | `/api/events/:id` | Bearer | Partial event edit; include `tickets` to replace tiers |
| `GET` | `/api/finance/settlements?status=` | Bearer | Settlements for an owned profile |

#### Team and audit

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` `GET` | `/api/team/roles` | Bearer | Create / list roles (`GET` needs `?businessProfileId=`) |
| `POST` `GET` | `/api/team/invitations` | Bearer | Send / list invitations (`GET` needs `?businessProfileId=`) |
| `GET` | `/api/team/invitations/:token` | Public | Preview an invitation from the emailed link |
| `POST` | `/api/team/invitations/:token` | Public | Accept; with `password` it also creates the member's credentials |
| `GET` | `/api/audit?businessProfileId=` | Bearer | Business audit log |

#### Platform administration

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` `PUT` | `/api/admin/commission` | Platform | Commission rules per service; `PUT {service, rate}` |
| `GET` `POST` | `/api/admin/kyc` | Platform | KYC queue; `POST {id, status, riskTier?}` decides |
| `GET` `PATCH` | `/api/admin/operators` | Platform | Operators directory; `PATCH ?id=` sets `accountStatus` |
| `GET` `POST` `PATCH` | `/api/admin/reconciliation` | Platform | Payment flags; `PATCH ?id=` resolves one |
| `GET` | `/api/admin/platform-audit` | Platform | Platform audit trail (last 200) |
| `GET` `POST` `PATCH` | `/api/admin/support-cases` | Platform | Support console; `PATCH ?id=` moves `status` |
| `GET` `POST` `PUT` | `/api/admin/roles` | Platform | Platform RBAC; `PUT ?name=` replaces permissions |

## Wiring the frontend

### 1. A typed client with automatic token refresh

Copy this into the Expo/web client (`lib/api.ts`). It attaches the bearer token,
refreshes once on `401`, and clears the session when refresh fails.

```ts
export const API_URL = "https://api-gamma-mocha-qn31xem8po.vercel.app";
// local API: "http://localhost:3000"

export type Tokens = { token: string; refreshToken: string };

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

let tokens: Tokens | null = null;
let onSessionLost: (() => void) | undefined;

export function setSession(next: Tokens | null) {
  tokens = next;
  // Persist in expo-secure-store / AsyncStorage, or memory only for web.
  if (!next) onSessionLost?.();
}
export function getSession() {
  return tokens;
}
export function setSessionLostHandler(handler: () => void) {
  onSessionLost = handler;
}

async function refreshTokens(): Promise<boolean> {
  if (!tokens?.refreshToken) return false;
  const res = await fetch(`${API_URL}/api/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: tokens.refreshToken }),
  });
  if (!res.ok) {
    setSession(null);
    return false;
  }
  const data = await res.json();
  setSession({ token: data.token, refreshToken: data.refreshToken });
  return true;
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; auth?: boolean } = {},
): Promise<T> {
  const { method = "GET", body, auth = true } = options;
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(auth && tokens ? { Authorization: `Bearer ${tokens.token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  // One transparent refresh-and-retry; never retry /api/auth/refresh itself.
  if (res.status === 401 && tokens?.refreshToken && path !== "/api/auth/refresh") {
    if (await refreshTokens()) return api<T>(path, options);
  }

  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, payload?.error ?? `Request failed (${res.status})`);
  }
  return payload as T;
}
```

### 2. Sign-in: password, then two-factor

`POST /api/auth/login` has two possible success shapes, so branch on `requires2FA`
rather than on HTTP status alone.

```ts
export type NextStep = "register-business" | "complete-profile" | "dashboard";

export interface AuthUser {
  id: number;
  name: string | null;
  email: string;
  phone: string | null;
  businessId: string;
  isInBusiness: boolean;
  businessProfileId: number | null;
  businessName: string | null;
  role: "owner" | "admin" | "operator" | "viewer" | null;
  permissions: string[];
  twoFactorEnabled: boolean;
  businessType: { id: number; name: string; slug: string } | null;
}

export type SignInResult =
  | { status: "authenticated"; token: string; refreshToken: string; user: AuthUser; nextStep: NextStep }
  | { status: "needs2FA"; challengeToken: string; maskedDestination: string; expiresIn: number };

export async function signIn(identifier: string, password: string): Promise<SignInResult> {
  const res = await fetch(`${API_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // identifier accepts a Business ID, an email, or a phone number
    body: JSON.stringify({ identifier, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new ApiError(res.status, data.error);

  if (data.requires2FA) {
    return {
      status: "needs2FA",
      challengeToken: data.challengeToken,
      maskedDestination: data.maskedDestination,
      expiresIn: data.expiresIn, // seconds; the code lives 10 minutes
    };
  }
  return {
    status: "authenticated",
    token: data.token,
    refreshToken: data.refreshToken,
    user: data.user,
    nextStep: data.nextStep,
  };
}

export async function verifyTwoFactor(challengeToken: string, code: string) {
  const res = await fetch(`${API_URL}/api/auth/2fa`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ challengeToken, code }),
  });
  const data = await res.json();
  if (!res.ok) throw new ApiError(res.status, data.error);
  setSession({ token: data.token, refreshToken: data.refreshToken });
  return { user: data.user as AuthUser, nextStep: data.nextStep as NextStep };
}

export async function resendTwoFactor(challengeToken: string) {
  return api("/api/auth/2fa/resend", {
    method: "POST",
    body: { challengeToken },
    auth: false,
  });
}
```

Signup and Google sign-in return the same `token` / `refreshToken` / `user` / `nextStep`
payload, so they can call `setSession(...)` and then the same routing function below.
Non-Google 2FA states to handle: `401` wrong code, `429` five failed attempts (restart
login), `410` expired challenge, `502` the code email could not be delivered.

### 3. Route the user with `nextStep`

Every session-producing endpoint (`signup`, `login`, `2fa`, `google`, invitation
accept) returns `nextStep`. Do not infer onboarding state from local flags.

| `nextStep` | Meaning | Client route |
| --- | --- | --- |
| `register-business` | Account exists, no business yet | Business type + name form |
| `complete-profile` | Business created, `missingFields` still empty-able | KYB details form |
| `dashboard` | Fully onboarded | Dashboard |

On app resume, call `GET /api/auth/me` and `GET /api/business/register`; the latter
returns `{ registered, missingFields, nextStep }` and is the cheapest way to decide where
to land without re-running login.

```ts
export async function resolveRoute() {
  const status = await api<{ registered: boolean; missingFields: string[]; nextStep: NextStep }>(
    "/api/business/register",
  );
  if (!status.registered) return "/onboarding/business";
  if (status.missingFields.length) return "/onboarding/profile";
  return "/dashboard";
}
```

### 4. Which endpoints power which screen

| Screen | Calls |
| --- | --- |
| Sign up | `POST /api/auth/signup`, then `GET /api/business-types` for the next form |
| Login | `POST /api/auth/login` → `POST /api/auth/2fa` (or `POST /api/auth/2fa/resend`) |
| App resume / gate | `GET /api/auth/me`, `GET /api/business/register` |
| Business registration | `POST /api/business/register` |
| Business details form | `GET /api/kyb`, `PUT /api/kyb/:id` |
| Browse events (public) | `GET /api/catalog/events?country=&q=` |
| Browse bus routes (public) | `GET /api/catalog/routes?origin=&destination=` |
| Event detail / checkout | `GET /api/events/:id`, `POST /api/payments/simulate`, `POST /api/bookings` |
| My tickets / trips | `GET /api/bookings`, `GET /api/bookings/:reference` |
| Send a parcel | `POST /api/parcels`, then `GET /api/parcels/:reference/tracking` |
| Track a parcel (public) | `GET /api/parcels/:reference/tracking` |
| Operator dashboard | `GET /api/fleet`, `/api/schedules`, `/api/drivers`, `/api/assignments`, `/api/bus-bookings` |
| Counter / POS | `POST /api/pos/tills`, `GET /api/pos/tills`, `POST /api/pos/transactions`, `PUT /api/pos/tills?id=` |
| Scanner | `POST /api/validations` (replay offline scans with `synced: false` + `occurredAt`) |
| Compliance | `GET`/`POST`/`PUT`/`DELETE /api/compliance` |
| Finance | `GET /api/finance/settlements` |
| Team settings | `POST`/`GET /api/team/roles`, `POST`/`GET /api/team/invitations` |
| Invitation deep link | `GET /api/team/invitations/:token`, then `POST /api/team/invitations/:token` |
| Audit trail | `GET /api/audit?businessProfileId=` |
| Platform console | `/api/admin/*` (see [Platform administration](#platform-administration)) |

### 5. Invitation deep links

`GET /api/team/invitations/:token` is public, so the landing page can render the
invitation before anyone signs in. `POST` with `{ password, phone? }` creates the
member's credentials and returns a full session (the person lands signed in with their
role); `POST` with no password requires the invitee's own bearer token. Both paths set
`user.isInBusiness`, `user.businessProfileId`, `user.role`, and `user.permissions` the
same way, so the client just calls `setSession(...)` and routes on `nextStep`.

### 6. Error handling

Every failure is `{ "error": "human readable message" }` with the status codes listed in
[Common errors](#common-errors). The client rules that matter:

- `401` on any protected call → refresh once (handled in `api()`); if that fails, clear
  the session and return to the login screen.
- `404` on an operator or team endpoint → the account has no business profile yet (or is
  not the owner). Re-run `GET /api/business/register` and route to onboarding.
- `409` → conflict the user can act on: duplicate signup, business already registered,
  till already open, schedule sold out, team member already exists.
- `410` / `429` / `502` on the 2FA endpoints → expired code, too many wrong codes, and
  undelivered email respectively. Restart from `POST /api/auth/login`.

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

Sessions expire after 24 hours. Refresh tokens are rotated on every use and are valid for 7 days; always replace the stored refresh token with the returned one. A revoked or expired session returns `401 Unauthorized`. `POST /api/auth/refresh` needs no bearer token — the refresh token in the body is the credential.

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

```bash
# Create a customer booking (kind: bus | event | parcel)
curl -X POST https://api-gamma-mocha-qn31xem8po.vercel.app/api/bookings \
  -H 'Authorization: Bearer <customer-token>' \
  -H 'Content-Type: application/json' \
  -d '{"kind":"bus","title":"Lilongwe to Blantyre","scheduledFor":"2026-09-25T06:00:00.000Z","amount":15000}'

# Read it back by the generated LMT- reference (owner only)
curl https://api-gamma-mocha-qn31xem8po.vercel.app/api/bookings/LMT-BUS-8F3K2M \
  -H 'Authorization: Bearer <customer-token>'

# Send a parcel, then track it (tracking needs no token)
curl -X POST https://api-gamma-mocha-qn31xem8po.vercel.app/api/parcels \
  -H 'Authorization: Bearer <operator-token>' \
  -H 'Content-Type: application/json' \
  -d '{"senderName":"Alice","recipientName":"Bob","origin":"Lilongwe","destination":"Blantyre","weightKg":5}'

curl https://api-gamma-mocha-qn31xem8po.vercel.app/api/parcels/LMT-PCL-7KD2QP/tracking
```

`GET /api/parcels/:reference/tracking` returns `reference`, `status`, `origin`,
`destination`, `weightKg`, and a chronological `timeline` of scans. Sender/recipient names
come back masked (`A***`) and `amount` is omitted for everyone except the owning profile,
so the tracking screen works for anonymous customers without leaking PII.

### Operator operations (owned business profile)

All operator endpoints resolve the caller's business profile automatically; a missing profile
returns `404`.

The CRUD resources below share one shape: `GET` to list, `POST` to create,
`PUT ?id=<rowId>` to update (omitted fields are kept), `DELETE ?id=<rowId>` to remove, and
a `404` when the row does not belong to the caller's business profile. `/api/validations`
and `/api/pos/tills` are the two exceptions: neither is deletable, and a till is opened with
`POST` and closed with `PUT ?id=`.

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

```bash
# KYC review queue, then approve
curl https://api-gamma-mocha-qn31xem8po.vercel.app/api/admin/kyc \
  -H 'Authorization: Bearer <platform-token>'

curl -X POST https://api-gamma-mocha-qn31xem8po.vercel.app/api/admin/kyc \
  -H 'Authorization: Bearer <platform-token>' \
  -H 'Content-Type: application/json' \
  -d '{"id":3,"status":"approved","riskTier":"low"}'

# Suspend an operator, set the events commission rate, resolve a payment flag
curl -X PATCH 'https://api-gamma-mocha-qn31xem8po.vercel.app/api/admin/operators?id=7' \
  -H 'Authorization: Bearer <platform-token>' \
  -H 'Content-Type: application/json' \
  -d '{"accountStatus":"suspended"}'

curl -X PUT https://api-gamma-mocha-qn31xem8po.vercel.app/api/admin/commission \
  -H 'Authorization: Bearer <platform-token>' \
  -H 'Content-Type: application/json' \
  -d '{"service":"events","rate":12.5}'

curl -X PATCH 'https://api-gamma-mocha-qn31xem8po.vercel.app/api/admin/reconciliation?id=4' \
  -H 'Authorization: Bearer <platform-token>' \
  -H 'Content-Type: application/json' \
  -d '{"status":"auto-refunded"}'
```

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
