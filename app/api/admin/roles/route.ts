import { NextRequest, NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { permissions, platformRolePermissions, platformRoles } from "@/drizzle/schema";
import { createPlatformAudit, getPlatformUser } from "@/lib/admin";
import { ensureOperationalSchema } from "@/lib/ensure-schema";

/**
 * Platform RBAC (staff RolesPanel; distinct from per-business team_roles).
 * GET /api/admin/roles — roles with their permission keys + all permissions.
 * POST /api/admin/roles — create role {name required, scope?, permissions?: string[]}.
 * PUT /api/admin/roles?name=<roleName> — replace the role's permission set.
 */
export async function GET(req: NextRequest) {
  try {
    await ensureOperationalSchema();
    const user = await getPlatformUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const allPermissions = await db.select().from(permissions).orderBy(asc(permissions.key));
    const roleRows = await db.select().from(platformRoles).orderBy(asc(platformRoles.id));
    const joins = await db.select().from(platformRolePermissions);

    const roles = roleRows.map((role) => ({
      id: role.id,
      name: role.name,
      scope: role.scope,
      permissions: joins
        .filter((join) => join.roleId === role.id)
        .map((join) => allPermissions.find((p) => p.id === join.permissionId)?.key)
        .filter(Boolean),
    }));

    return NextResponse.json({
      roles,
      permissions: allPermissions.map((p) => p.key),
    });
  } catch (err) {
    console.error("List roles error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureOperationalSchema();
    const user = await getPlatformUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    if (!body.name) return NextResponse.json({ error: "name is required" }, { status: 400 });

    const scope = body.scope ?? "platform";
    if (!["platform", "operator", "field"].includes(scope)) {
      return NextResponse.json({ error: "scope must be platform, operator, or field" }, { status: 400 });
    }

    const [created] = await db
      .insert(platformRoles)
      .values({ name: String(body.name), scope })
      .returning();

    // Optionally attach permissions on create.
    if (Array.isArray(body.permissions) && body.permissions.length) {
      const keys = body.permissions.map(String);
      const perms = await db.select().from(permissions);
      const values = perms
        .filter((p) => keys.includes(p.key))
        .map((p) => ({ roleId: created.id, permissionId: p.id }));
      if (values.length) await db.insert(platformRolePermissions).values(values);
    }

    await createPlatformAudit(user.email ?? `user-${user.id}`, "Created role", `role/${created.name}`);

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    console.error("Create role error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    await ensureOperationalSchema();
    const user = await getPlatformUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const name = new URL(req.url).searchParams.get("name");
    if (!name) return NextResponse.json({ error: "name query param required" }, { status: 400 });

    const [role] = await db.select().from(platformRoles).where(eq(platformRoles.name, name)).limit(1);
    if (!role) return NextResponse.json({ error: "Role not found" }, { status: 404 });

    const body = await req.json();
    if (!Array.isArray(body.permissions)) {
      return NextResponse.json({ error: "permissions array is required" }, { status: 400 });
    }

    const keys = body.permissions.map(String);
    const perms = await db.select().from(permissions);

    await db.transaction(async (tx) => {
      await tx.delete(platformRolePermissions).where(eq(platformRolePermissions.roleId, role.id));
      const values = perms
        .filter((p) => keys.includes(p.key))
        .map((p) => ({ roleId: role.id, permissionId: p.id }));
      if (values.length) await tx.insert(platformRolePermissions).values(values);
    });

    await createPlatformAudit(
      user.email ?? `user-${user.id}`,
      "Updated role permissions",
      `role/${role.name}`
    );

    return NextResponse.json({ id: role.id, name: role.name, scope: role.scope, permissions: keys });
  } catch (err) {
    console.error("Update role permissions error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
