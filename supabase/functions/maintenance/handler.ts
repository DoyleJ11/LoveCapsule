export interface Job {
  id: string;
  kind: "cleanup" | "account" | "push";
  payload: Record<string, string>;
  lease_id: string;
  ticket_id: string | null;
  dedupe_key: string;
}
export interface WorkerServices {
  prepare(): Promise<void>;
  claim(): Promise<Job[]>;
  finish(
    job: Job,
    outcome: "done" | "retry" | "receipt" | "invalid_token",
    code?: string,
    ticket?: string,
  ): Promise<void>;
  referenced(path: string): Promise<boolean>;
  remove(path: string): Promise<void>;
  deleteUser(id: string): Promise<void>;
  canNotify(job: Job): Promise<boolean>;
  fetch: typeof fetch;
  pushAccessToken?: string;
}
function authorized(actual: string | null, expected: string) {
  if (expected.length < 32 || !actual) return false;
  const a = new TextEncoder().encode(actual),
    b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i];
  return diff === 0;
}
/** No request-supplied records, recipient IDs, file paths or tokens are used. */
export async function handleMaintenance(
  req: Request,
  secret: string,
  services: WorkerServices,
): Promise<Response> {
  const json = (value: unknown, status = 200) =>
    Response.json(value, { status });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!authorized(req.headers.get("x-worker-secret"), secret)) {
    return json({ error: "Unauthorized" }, 401);
  }
  try {
    await services.prepare();
    const jobs = await services.claim();
    let completed = 0, retried = 0;
    for (const job of jobs) {
      try {
        if (job.kind === "cleanup") {
          if (!await services.referenced(job.payload.path)) {
            await services.remove(job.payload.path);
          }
          await services.finish(job, "done");
        } else if (job.kind === "account") {
          await services.deleteUser(job.payload.user_id);
          await services.finish(job, "done");
        } else if (!await services.canNotify(job)) {
          await services.finish(job, "done", "recipient_inactive");
        } else {
          const receipts = !!job.ticket_id;
          const response = await services.fetch(
            `https://exp.host/--/api/v2/push/${
              receipts ? "getReceipts" : "send"
            }`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(services.pushAccessToken
                  ? { Authorization: `Bearer ${services.pushAccessToken}` }
                  : {}),
              },
              body: JSON.stringify(
                receipts ? { ids: [job.ticket_id] } : {
                  to: job.payload.token,
                  title: "LoveCapsule",
                  body: job.payload.type === "new_entry"
                    ? "A new note has been saved for you."
                    : "Your capsule has a reveal ready to open.",
                  data: {
                    type: job.payload.type,
                    notification_id: job.id,
                    couple_id: job.payload.couple_id,
                  },
                  sound: "default",
                  ttl: 3600,
                },
              ),
              signal: AbortSignal.timeout(15000),
            },
          );
          if (!response.ok) throw new Error("provider_http");
          const body = await response.json();
          const ticket = receipts ? body.data?.[job.ticket_id!] : body.data;
          if (!ticket) {
            await services.finish(
              job,
              receipts ? "receipt" : "retry",
              "provider_pending",
            );
          } else if (ticket.status === "error") {
            await services.finish(
              job,
              ticket.details?.error === "DeviceNotRegistered"
                ? "invalid_token"
                : "retry",
              [
                  "DeviceNotRegistered",
                  "InvalidCredentials",
                  "MessageTooBig",
                  "MessageRateExceeded",
                ].includes(ticket.details?.error)
                ? ticket.details.error
                : "provider_error",
            );
          } else if (ticket.status === "ok" && (receipts || ticket.id)) {
            await services.finish(
              job,
              receipts ? "done" : "receipt",
              undefined,
              ticket.id,
            );
          } else await services.finish(job, "retry", "provider_response");
        }
        completed++;
      } catch {
        // Only fixed codes leave the worker: SDK errors can include URLs/tokens.
        retried++;
        await services.finish(job, "retry", "operation_failed");
      }
    }
    return json({ processed: completed, retried });
  } catch {
    return json({ error: "maintenance_unavailable" }, 503);
  }
}
