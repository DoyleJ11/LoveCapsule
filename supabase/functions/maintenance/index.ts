import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";
import { handleMaintenance, type Job } from "./handler.ts";
const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(15000) }),
    },
  },
);
const checked = async (
  query: PromiseLike<{ error: unknown; data: unknown }>,
) => {
  const { data, error } = await query;
  if (error) throw error;
  return data;
};
Deno.serve((req) =>
  handleMaintenance(req, Deno.env.get("MAINTENANCE_SECRET") ?? "", {
    prepare: async () => {
      await checked(admin.rpc("prepare_maintenance"));
    },
    claim: async () =>
      await checked(admin.rpc("claim_maintenance", { p_limit: 3 })) as Job[],
    finish: async (job, outcome, code, ticket) => {
      await checked(
        admin.rpc("finish_maintenance", {
          p_id: job.id,
          p_lease: job.lease_id,
          p_outcome: outcome,
          p_code: code ?? null,
          p_ticket: ticket ?? null,
        }),
      );
    },
    referenced: async (path) => {
      const values = await Promise.all([
        checked(
          admin.from("media").select("id").eq("storage_path", path).limit(1),
        ),
        checked(
          admin.from("media").select("id").eq("thumbnail_path", path).limit(1),
        ),
        checked(
          admin.from("profiles").select("id").eq("avatar_url", path).limit(1),
        ),
      ]);
      return values.some((rows) => (rows as unknown[]).length > 0);
    },
    remove: async (path) => {
      await checked(admin.storage.from("entry-media").remove([path]));
    },
    deleteUser: async (id) => {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error && error.code !== "user_not_found") throw error;
    },
    canNotify: async (job) =>
      Boolean(
        await checked(admin.rpc("can_deliver_notice", { p_job: job.id })),
      ),
    fetch,
    pushAccessToken: Deno.env.get("EXPO_ACCESS_TOKEN"),
  })
);
