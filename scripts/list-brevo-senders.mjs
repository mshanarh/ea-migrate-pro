/**
 * One-off: list the senders configured in the Brevo account (names + emails +
 * verification status) so a missing sender can be fixed quickly.
 */
const key = (process.env["BREVO_API_KEY"] ?? "").trim();
if (!key) {
  console.log("BREVO_API_KEY not set");
  process.exit(1);
}
const response = await fetch("https://api.brevo.com/v3/senders", {
  headers: { "api-key": key, accept: "application/json" },
});
if (!response.ok) {
  console.log("senders request failed:", response.status);
  process.exit(1);
}
const data = (await response.json()) ?? {};
const senders = Array.isArray(data.senders) ? data.senders : [];
console.log("Senders configured:", senders.length);
for (const sender of senders) {
  console.log(` - ${sender.email} | name: ${sender.name ?? "(none)"} | verified: ${sender.verified ? "yes" : "NO"}`);
}
