/**
 * WHO PAID ON WHOP — asked of WHOP, not of a database.
 *
 * This is the checkout provider's own verification: it answers "does this email
 * have an active membership on OUR product". It is NOT a second store of record
 * — nothing here reads or writes an account, a payment flag, a licence key or a
 * device binding, and it writes nothing at all (the old back-fill of
 * `users.is_paid` is deliberately gone). The KV record remains the only place a
 * payment is RECORDED; this just confirms a brand-new checkout before the owner
 * marks the account paid.
 */
import { createServerFn } from "@tanstack/react-start";

type EmailInput = { email: string };

/**
 * Whop membership verification — SERVER-side, using WHOP_API_KEY (a secret
 * that must be set in the production environment; the anon key is public).
 * This is the only trustworthy answer to "did this email actually pay?":
 * the ?success=true URL parameter is forged by typing the URL, which is
 * exactly how a non-payer unlocked the app before this check existed.
 */
export const whopVerifyMembership = createServerFn({ method: "POST" })
  .validator((data: EmailInput) => data)
  .handler(async ({ data }): Promise<{ ok: boolean; paid: boolean; error?: string }> => {
    const apiKey = (process.env["WHOP_API_KEY"] ?? process.env["VITE_WHOP_API_KEY"] ?? "").trim();
    const productId = (process.env["WHOP_PRODUCT_ID"] ?? process.env["VITE_WHOP_PRODUCT_ID"] ?? "").trim();
    if (!apiKey) return { ok: false, paid: false, error: "WHOP_API_KEY is not configured" };
    // AN UNSCOPED WHOP QUERY CANNOT PROVE PAYMENT, SO IT IS NOT ASKED.
    // `product` is what narrows the membership list to OUR product. Without it
    // the API answers with every membership on the account, so a person who
    // ever bought anything from any other seller on Whop would be confirmed as
    // a paying customer of this one — and this is a path that opens the app
    // without an entry in the payment ledger. That is precisely the "not marked
    // paid, still got in" case, so an unset product id answers "no" rather than
    // falling back to a broader-than-honest query. Set WHOP_PRODUCT_ID (or
    // VITE_WHOP_PRODUCT_ID) to re-enable this.
    if (!productId) return { ok: false, paid: false, error: "WHOP_PRODUCT_ID is not configured" };
    try {
      const url = new URL("https://api.whop.com/api/v1/memberships");
      url.searchParams.set("page_size", "100");
      if (productId) url.searchParams.set("product", productId);
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        return { ok: false, paid: false, error: `Whop API ${response.status}` };
      }
      const payload = (await response.json()) as {
        data?: Array<{ status?: string; user?: { email?: string } }>;
      };
      const clean = data.email.trim().toLowerCase();
      const paid = (payload.data ?? []).some(
        (membership) =>
          membership.user?.email?.trim().toLowerCase() === clean &&
          (membership.status === "active" || membership.status === "trialing" || membership.status === "past_due"),
      );
      if (paid) {
        // NO WRITES HERE. This check used to "back-fill" `users.is_paid = true`
        // so future checks would be database-only, and that single line is how
        // accounts the owner never marked paid ended up on the console's Paid
        // list anyway. `WHOP_PRODUCT_ID` is optional, so with it unset this
        // query is NOT scoped to our product: any membership the email has
        // over Whop, on any product, satisfied it — and the back-fill then
        // stamped that on the account permanently. A READ that writes the
        // payment flag is the approve-to-paid drift, so it is gone: payment is
        // recorded by the console's own ledger (Mark paid) or by a real licence
        // key activation, and nothing else. Genuine payers are unaffected —
        // the answer above is what opens the app.
        console.log("[whop] active membership confirmed for", clean, "(no payment flag written)");
      }
      return { ok: true, paid };
    } catch (error) {
      return { ok: false, paid: false, error: error instanceof Error ? error.message : "Whop check failed" };
    }
  });

/**
 * Secure license-key issuance — runs SERVER-side with the service-role key,
 * which bypasses RLS. The old browser-side anon upsert in send-email.ts
 * becomes a forge hole once RLS is tightened (anyone could insert a row for
 * their own email), so issuance moves here. Called from the mentor portal's
 * license-issuance flow instead of the anon client.
 */
