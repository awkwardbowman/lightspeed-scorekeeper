import { createClient } from "https://esm.sh/@supabase/supabase-js@2.119.0";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
Deno.serve(async (req: Request) => {
  const reply = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  if (req.method === "OPTIONS") return reply({});
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const url = Deno.env.get("SUPABASE_URL")!;
    const service = createClient(
      url,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
      auth: { persistSession: false },
    });
    const { data: identity, error: identityError } =
      await caller.auth.getUser();
    if (identityError || !identity.user)
      return reply({ error: "Sign in required" }, 401);
    const { data: profile, error: profileError } =
      await caller.rpc("account_status");
    if (profileError || !profile?.is_active || profile.is_deleted)
      return reply({ error: "Account disabled or session revoked" }, 403);
    const body = await req.json();
    const action = body.action;
    const name =
      typeof body.display_name === "string" ? body.display_name.trim() : "";
    const password = body.password;
    const check = (error: { message: string } | null) => {
      if (error) throw new Error(error.message);
    };
    const passwordValid = () => {
      if (
        typeof password !== "string" ||
        password.length < 12 ||
        password.length > 128
      )
        throw new Error("Use a password of 12–128 characters.");
    };
    const audit = async (
      recordId: string,
      type: string,
      before: unknown,
      after: unknown,
    ) => {
      const { error } = await service.from("tAudit").insert({
        table_name: "tUser",
        record_id: recordId,
        action: type,
        actor_id: identity.user!.id,
        old_value: before,
        new_value: after,
      });
      check(error);
    };
    if (action === "password") {
      passwordValid();
      if (body.id && body.id !== identity.user.id)
        return reply({ error: "You can only change your own password" }, 403);
      // Forward only the verified caller token; never use the service credential for passwords.
      const updated = await fetch(`${url}/auth/v1/user`, {
        method: "PUT",
        headers: {
          Authorization: auth,
          apikey: Deno.env.get("SUPABASE_ANON_KEY")!,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password }),
      });
      if (!updated.ok)
        throw new Error(
          "Password update failed. Request a fresh recovery link and try again.",
        );
      const { error } = await service
        .from("tUser")
        .update({ must_change_password: false })
        .eq("id", identity.user.id);
      check(error);
      await audit(
        identity.user.id,
        "password_changed",
        { must_change_password: profile.must_change_password },
        { must_change_password: false },
      );
      return reply({ ok: true });
    }
    if (profile.must_change_password)
      return reply({ error: "Set your password first" }, 403);
    if (action === "profile") {
      if (!name || name.length > 120)
        throw new Error("A display name is required (120 characters maximum).");
      const { error } = await service
        .from("tUser")
        .update({ display_name: name })
        .eq("id", identity.user.id);
      check(error);
      await audit(
        identity.user.id,
        "profile_changed",
        { display_name: profile.display_name },
        { display_name: name },
      );
      return reply({ ok: true });
    }
    if (action === "reset" || action === "create")
      return reply(
        { error: "Use email invitations and self-service password recovery" },
        403,
      );
    if (action === "invite") {
      if (name.length > 120)
        throw new Error("Display name must be at most 120 characters.");
      const email =
        typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const { data: reservation, error: reserveError } = await caller.rpc(
        "reserve_invitation",
        { p_email: email },
      );
      check(reserveError);
      const { data, error } = await service.auth.admin.inviteUserByEmail(
        email,
        {
          redirectTo: "https://lightspeed-scorekeeper.vercel.app/?auth=invite",
        },
      );
      if (error) {
        check(
          (
            await service
              .from("tInvitation")
              .update({
                status: "failed",
                updated_at: new Date().toISOString(),
              })
              .eq("id", reservation)
          ).error,
        );
        throw error;
      }
      // The emailed link is the recipient's credential; it never reaches the inviter.
      const provision = await service
        .from("tUser")
        .insert({
          id: data.user!.id,
          email,
          display_name: name || email.split("@")[0].slice(0, 120),
          app_role: "management",
          is_active: true,
          must_change_password: true,
          created_by: identity.user.id,
        });
      if (provision.error) {
        await service.auth.admin.updateUserById(data.user!.id, {
          ban_duration: "876000h",
        });
        await service
          .from("tInvitation")
          .update({ status: "failed" })
          .eq("id", reservation);
        throw provision.error;
      }
      check(
        (
          await service
            .from("tInvitation")
            .update({ status: "sent", updated_at: new Date().toISOString() })
            .eq("id", reservation)
        ).error,
      );
      await audit(data.user!.id, "account_invited", null, {
        email,
        invited_by: identity.user.id,
      });
      return reply({ ok: true });
    }
    if (profile.app_role !== "admin")
      return reply({ error: "Admin access required" }, 403);
    if (action === "list") {
      const { data, error } = await service
        .from("tUser")
        .select("*")
        .order("created_at");
      check(error);
      return reply({ users: data });
    }
    const { data: target, error } = await service
      .from("tUser")
      .select("*")
      .eq("id", body.id)
      .single();
    check(error);
    if (target.app_role === "admin")
      throw new Error(
        "The sole Admin cannot be disabled, reset or deleted here. Use My account.",
      );
    if (action === "disable" || action === "enable" || action === "delete") {
      const deleted = action === "delete";
      if (deleted && body.confirm !== target.email)
        throw new Error("Type the user email to confirm deletion.");
      check(
        (
          await service
            .from("tUser")
            .update({
              is_active: action === "enable",
              is_deleted: deleted || target.is_deleted,
            })
            .eq("id", target.id)
        ).error,
      );
      if (action !== "enable")
        await service.rpc("revoke_account_sessions", { p_id: target.id });
      check(
        (
          await service.auth.admin.updateUserById(target.id, {
            ban_duration: action === "enable" ? "none" : "876000h",
          })
        ).error,
      );
      await audit(
        target.id,
        `account_${action}`,
        { is_active: target.is_active },
        { is_active: action === "enable", is_deleted: deleted },
      );
    } else if (action === "edit") {
      if (!name || name.length > 120 || typeof body.email !== "string")
        throw new Error("Email and name required.");
      if (
        body.email &&
        body.email.trim().toLowerCase() !== target.email.toLowerCase()
      )
        throw new Error("Account email changes are not available here.");
      check(
        (
          await service
            .from("tUser")
            .update({ display_name: name })
            .eq("id", target.id)
        ).error,
      );
      await audit(
        target.id,
        "account_edited",
        { email: target.email, display_name: target.display_name },
        { email: body.email.trim(), display_name: name },
      );
    } else throw new Error("Unknown account action");
    return reply({ ok: true });
  } catch (error) {
    return reply(
      {
        error:
          error instanceof Error ? error.message : "Account operation failed",
      },
      400,
    );
  }
});
