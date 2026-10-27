// Retired unauthenticated webhook. Publication and reveal notices now originate
// from canonical database outbox rows; this endpoint never trusts request data.
Deno.serve(() =>
  Response.json({ error: "Use the authenticated maintenance worker." }, {
    status: 410,
  })
);
