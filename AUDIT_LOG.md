# Audit log standard

This service records team and access actions in the `audit_logs` table so business activity is traceable and reviewable like a professional platform.

## Purpose

Audit records answer:
- Who performed the action?
- What resource was affected?
- Which business context owns it?
- When did it happen?
- What changed?

## Stored fields

- `actor_user_id`: the authenticated user who performed the action
- `target_user_id`: the affected user, when relevant
- `business_profile_id`: the business scoped to the action
- `team_role_id`: the role involved
- `team_invitation_id`: the invitation involved
- `action`: e.g. `created`, `updated`, `invited`, `accepted`, `deleted`
- `resource_type`: e.g. `team_role`, `team_invitation`, `team_member`
- `resource_id`: the database ID of the affected record
- `details`: JSON payload with the specific data change
- `created_at`: timestamp of the action

## Example events

- Admin created a team role
- Admin invited a teammate
- Teammate accepted an invitation
- Audit records are available via the `/api/audit` route scoped to the business profile

## Governance

- All actions are tracked by business ownership.
- The actor is always captured to maintain accountability.
- Each record is tied to a specific business profile when applicable.
- Role and invitation changes are retained for review and debugging.
