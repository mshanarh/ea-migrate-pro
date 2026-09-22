/**
 * Shared-store census — how many mentor/admin accounts exist in the same
 * Upstash store this deployment uses. Prints only MASKED emails and counts
 * (never passwords, never full addresses) so a migration can be verified.
 * Run: bun scripts/count-accounts.mjs
 */
const url = (process.env.UPSTASH_REDIS_REST_URL ?? "").trim().replace(/\/+$/, "");
const token = (process.env.UPSTASH_REDIS_REST_TOKEN ?? "").trim();
if (!url || !token) {
  console.log("RESULT: FAIL — Upstash not configured");
  process.exit(1);
}
const response = await fetch(`${url}/hgetall/eamp%3Aaccounts`, {
  headers: { Authorization: `Bearer ${token}` },
});
if (!response.ok) {
  console.log("RESULT: FAIL — HTTP", response.status);
  process.exit(1);
}
const payload = await response.json();
const flat = Array.isArray(payload?.result) ? payload.result : [];
const mask = (email) => {
  const [name, domain] = String(email).split("@");
  return `${name.slice(0, 3)}***@${domain ?? "***"}`;
};
let mentorsPending = 0, mentorsApproved = 0, admins = 0, withEas = 0, withPassword = 0;
for (let i = 0; i < flat.length; i += 2) {
  try {
    const account = JSON.parse(flat[i + 1]);
    const email = String(account.email ?? "").toLowerCase();
    if (account.role === "admin") admins += 1;
    else if (account.status === "approved") mentorsApproved += 1;
    else mentorsPending += 1;
    if (Array.isArray(account.eas) && account.eas.length > 0) withEas += 1;
    if (typeof account.password === "string" && account.password.length > 0) withPassword += 1;
    const flag = account.role === "admin" ? "[admin]" : `[${account.status}]`;
    console.log(` - ${mask(email)} ${flag} eas:${Array.isArray(account.eas) ? account.eas.length : 0} keys:${Array.isArray(account.licenses) ? account.licenses.length : 0}`);
  } catch {
    /* skip malformed */
  }
}
console.log(`TOTAL records: ${flat.length / 2} | admins: ${admins} | mentors approved: ${mentorsApproved} | mentors pending: ${mentorsPending} | with EAs: ${withEas} | with password: ${withPassword}`);
console.log("RESULT: OK");
