import {
  handleMaintenance,
  type Job,
  type WorkerServices,
} from "../handler.ts";
const secret = "a".repeat(40);
const job: Job = {
  id: "job",
  kind: "push",
  payload: {
    token: "ExpoPushToken[secret]",
    type: "reveal_ready",
    couple_id: "couple",
  },
  lease_id: "lease",
  ticket_id: null,
  dedupe_key: "checkpoint:occ:device",
};
function fixture(jobs: Job[] = [job]) {
  const calls: unknown[][] = [];
  const service: WorkerServices = {
    prepare: async () => {},
    claim: async () => jobs,
    finish: async (...args) => {
      calls.push(args);
    },
    referenced: async () => false,
    remove: async () => {},
    deleteUser: async () => {},
    canNotify: async () => true,
    fetch: async () => Response.json({ data: { status: "ok", id: "ticket" } }),
  };
  return { service, calls };
}
function assert(value: unknown, message = "Assertion failed") {
  if (!value) throw new Error(message);
}
const request = (key = secret) =>
  new Request("https://worker.test", {
    method: "POST",
    headers: { "x-worker-secret": key },
  });
Deno.test("rejects unauthenticated calls before queue access", async () => {
  const { service, calls } = fixture();
  service.prepare = () => {
    throw new Error("must not run");
  };
  assert(
    (await handleMaintenance(request("wrong"), secret, service)).status === 401,
  );
  assert(calls.length === 0);
});
Deno.test("ticket acknowledgement is not reported as delivery; receipt completes it", async () => {
  const { service, calls } = fixture();
  await handleMaintenance(request(), secret, service);
  assert(calls[0][1] === "receipt" && calls[0][3] === "ticket");
  calls.length = 0;
  service.claim = async () => [{ ...job, ticket_id: "ticket" }];
  service.fetch = async () =>
    Response.json({ data: { ticket: { status: "ok" } } });
  await handleMaintenance(request(), secret, service);
  assert(calls[0][1] === "done");
});
Deno.test("invalid-token receipts are retired, provider/network failures retry", async () => {
  const { service, calls } = fixture();
  service.fetch = async () =>
    Response.json({
      data: { status: "error", details: { error: "DeviceNotRegistered" } },
    });
  await handleMaintenance(request(), secret, service);
  assert(calls[0][1] === "invalid_token");
  calls.length = 0;
  service.fetch = async () => {
    throw new Error("contains private provider URL");
  };
  const result = await handleMaintenance(request(), secret, service);
  assert(calls[0][1] === "retry");
  assert(!(await result.text()).includes("private"));
});
Deno.test("cleanup retries and retains canonical referenced files", async () => {
  const { service, calls } = fixture([{
    ...job,
    kind: "cleanup",
    payload: { path: "full/path.jpg" },
  }]);
  let removed = 0;
  service.referenced = async () => true;
  service.remove = async () => {
    removed++;
  };
  await handleMaintenance(request(), secret, service);
  assert(removed === 0 && calls[0][1] === "done");
  calls.length = 0;
  service.referenced = async () => false;
  service.remove = async () => {
    throw new Error("storage offline");
  };
  await handleMaintenance(request(), secret, service);
  assert(calls[0][1] === "retry");
});
Deno.test("inactive or rescheduled notices are skipped and payloads never expose diary content", async () => {
  const { service, calls } = fixture();
  service.canNotify = async () => false;
  service.fetch = () => {
    throw new Error("must not send");
  };
  await handleMaintenance(request(), secret, service);
  assert(calls[0][1] === "done");
  service.canNotify = async () => true;
  service.fetch = async (_, init) => {
    const text = String((init as { body?: unknown })?.body);
    assert(!text.includes("author") && !text.includes("content_plain"));
    return Response.json({ data: { status: "ok", id: "ticket" } });
  };
  await handleMaintenance(request(), secret, service);
});
