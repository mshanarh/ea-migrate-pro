/**
 * Is the Supabase `send-email` EDGE FUNCTION live?
 *
 * This is the answer to "how does a static deployment send email at all": the
 * browser POSTs to `${SUPABASE_URL}/functions/v1/send-email` with the public
 * anon key, and the Brevo secret stays on Supabase. src/lib/send-email.ts
 * already uses it (with a browser fallback), so it is the platform's own
 * answer to this problem rather than something invented here.
 *
 * Run: bun scripts/probe-edge-email.ts
 */
import { createClient } from "@supabase/supabase-js";

const url = (process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "").trim();
const anonKey = (process.env["VITE_SUPABASE_ANON_KEY"] ?? "").trim();
if (!url || !anonKey) {
  console.log("Missing Supabase env — nothing probed.");
  process.exit(1);
}

const target = "probe.edge.email@eamigratepro.invalid";

async function main() {
  // A deliberately UNKNOWN kind: it must be rejected by the function itself
  // (which proves the function is deployed and validating), without sending
  // any real email.
  const response = await fetch(`${url}/functions/v1/send-email`, {
    method: "POST",
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, "content-type": "application/json" },
    body: JSON.stringify({ kind: "probe-not-a-real-kind", to: target, params: {} }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.text().catch(() => "");
  console.log(`edge function POST -> ${response.status}`);
  console.log(`body: ${body.slice(0, 300)}`);

  // Also probe the activation_code kind we intend to add, to a non-deliverable
  // address, so we learn whether the deployed function already knows it.
  const codeProbe = await fetch(`${url}/functions/v1/send-email`, {
    method: "POST",
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, "content-type": "application/json" },
    body: JSON.stringify({ kind: "activation_code", to: target, params: { code: "000000" } }),
    signal: AbortSignal.timeout(20_000),
  });
  const codeBody = await codeProbe.text().catch(() => "");
  console.log(`activation_code POST -> ${codeProbe.status}`);
  console.log(`body: ${codeBody.slice(0, 300)}`);

  // Was any mail actually queued? A non-deliverable domain must bounce, and a
  // working API returns success even so — which is all we can assert here.
  void createClient;
  console.log("probe complete");
}

void main();