// Edge Function "manage-hosts"
// Permite al SUPER ADMIN crear la cuenta de un anfitrión con contraseña,
// cambiarle la contraseña o eliminar su cuenta. Usa la clave service_role,
// que vive solo en el servidor de Supabase (nunca en la página).
//
// Cómo crearla: Supabase > Edge Functions > Deploy a new function > Via Editor,
// nombre: manage-hosts, pega este archivo y pulsa Deploy.

import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    // 1) ¿Quién llama? Debe estar logueado y ser super admin.
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: who, error: whoErr } = await admin.auth.getUser(token);
    if (whoErr || !who?.user?.email) return json({ error: "not_authenticated" }, 401);
    const callerEmail = who.user.email.toLowerCase();

    const { data: supers, error: supErr } = await admin.from("super_admins").select("email");
    if (supErr) throw supErr;
    const superEmails = (supers ?? []).map((s) => String(s.email).toLowerCase());
    if (!superEmails.includes(callerEmail)) return json({ error: "not_super_admin" }, 403);

    // 2) Qué quiere hacer.
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "invalid_email" }, 400);

    const findUser = async () => {
      for (let page = 1; page <= 20; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) throw error;
        const u = data.users.find((x) => (x.email ?? "").toLowerCase() === email);
        if (u) return u;
        if (data.users.length < 1000) return null;
      }
      return null;
    };

    if (action === "set_password") {
      const password = String(body.password ?? "");
      if (password.length < 8) return json({ error: "weak_password" }, 400);
      const existing = await findUser();
      if (existing) {
        const { error } = await admin.auth.admin.updateUserById(existing.id, { password, email_confirm: true });
        if (error) throw error;
        return json({ ok: true, created: false });
      }
      const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error) throw error;
      return json({ ok: true, created: true });
    }

    if (action === "delete_user") {
      if (superEmails.includes(email)) return json({ error: "cannot_delete_super_admin" }, 400);
      const existing = await findUser();
      if (existing) {
        const { error } = await admin.auth.admin.deleteUser(existing.id);
        if (error) throw error;
      }
      return json({ ok: true });
    }

    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
