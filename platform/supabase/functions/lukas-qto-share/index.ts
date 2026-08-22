import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json; charset=utf-8",
};
const statuses = new Set(["open", "in_review", "resolved", "blocked"]);

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: cors });
  try {
    const { token, action, status, note, file_id } = await request.json();
    if (typeof token !== "string" || !/^[0-9a-f-]{36}$/i.test(token)) throw new Error("Invalid share token");
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: share } = await admin.from("lukas_qto_shares").select("project_id, permission, expires_at").eq("token", token).maybeSingle();
    if (!share || (share.expires_at && new Date(share.expires_at) <= new Date())) return new Response(JSON.stringify({ error: "This share link is invalid or expired." }), { status: 404, headers: cors });
    if (action === "review") {
      if (share.permission !== "review") return new Response(JSON.stringify({ error: "This share link is read-only." }), { status: 403, headers: cors });
      if (!statuses.has(status) || typeof note !== "string" || !note.trim() || note.length > 5000) throw new Error("Invalid review input");
      if (file_id) { const { data: file } = await admin.from("lukas_qto_files").select("id").eq("id", file_id).eq("project_id", share.project_id).maybeSingle(); if (!file) throw new Error("Invalid file"); }
      const { error } = await admin.from("lukas_qto_reviews").insert({ project_id: share.project_id, file_id: file_id || null, author_id: null, status, note: note.trim() });
      if (error) throw error;
    }
    const [{ data: project }, { data: files }, { data: reviews }] = await Promise.all([
      admin.from("lukas_qto_projects").select("id,name,description").eq("id", share.project_id).single(),
      admin.from("lukas_qto_files").select("id,kind,original_filename,byte_size,sha256").eq("project_id", share.project_id).order("created_at", { ascending: false }),
      admin.from("lukas_qto_reviews").select("id,status,note,updated_at").eq("project_id", share.project_id).order("updated_at", { ascending: false }),
    ]);
    return new Response(JSON.stringify({ project, permission: share.permission, files: files ?? [], reviews: reviews ?? [] }), { headers: cors });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Request failed" }), { status: 400, headers: cors });
  }
});
