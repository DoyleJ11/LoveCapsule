type Failure = {
  area: 'account' | 'reveal' | 'entries';
  event: number;
  code: 'request_failed';
  at: string;
};
const recent: Failure[] = [];
let sequence = 0;
/** Allowlisted metadata only. Never accepts errors, payloads, IDs, URLs or tokens. */
export function recordFailure(area: Failure['area']) {
  const failure: Failure = {
    area,
    event: ++sequence,
    code: 'request_failed',
    at: new Date().toISOString(),
  };
  recent.push(failure);
  if (recent.length > 20) recent.shift();
  return failure.event;
}
export function diagnosticSnapshot(): readonly Failure[] {
  return recent.map((row) => ({ ...row }));
}
export function clearDiagnostics() {
  recent.length = 0;
}
