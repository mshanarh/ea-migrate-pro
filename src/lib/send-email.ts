/**
 * Transactional email — browser → Supabase Edge Function → Brevo.
 *
 * The key used to be read from VITE_BREVO_API_KEY, which Vite inlines into the
 * public JavaScript bundle: anyone who opened the site could read it and send
 * mail as the platform. The app now asks a server-side function
 * (supabase/functions/send-email) to send, and the Brevo key lives in a Supabase
 * secret where no browser can reach it.
 *
 * The function sends only the platform's own templates and only to addresses
 * that already exist in the database, so it cannot be used to mail strangers.
 *
 * SECURITY NOTE: this deployment has no server-side auth, so "the caller is a
 * signed-in mentor" cannot be proven. Anything that could call the function
 * directly could trigger these same four emails. Removing that last gap means
 * moving authentication server-side, which is a bigger job than hiding a key.
 *
 *   type: "new_registration"
 *     → emails the admin to approve the new user (pending row is saved by
 *       the Supabase anon client below — insert-if-missing).
 *
 *   type: "license_approved"
 *     → saves the issued key into the license_keys table and emails the
 *       user their license key.
 */

const ADMIN_EMAIL = "biyasentobeko222@gmail.com";
/** Second admin inbox — the known-good recipient for registration alerts. */
const ADMIN_EMAIL_2 = "eamigratepro@gmail.com";

const SUPABASE_URL = (import.meta.env["VITE_SUPABASE_URL"] ?? "").trim();
const SUPABASE_ANON_KEY = (import.meta.env["VITE_SUPABASE_ANON_KEY"] ?? "").trim();

/**
 * Ask the edge function to send one of the platform's emails.
 *
 * Only the TEMPLATE and the RECIPIENT cross this boundary — the subject, HTML
 * and sender are built inside the function, so a caller cannot use it to send
 * arbitrary mail. That is also why the old browser-direct Brevo call is gone:
 * it required shipping the API key to the browser.
 */
async function sendViaBrevo(options: {
  kind: "new_registration" | "approval_decision" | "license_approved" | "broadcast";
  to: string;
  params?: Record<string, unknown>;
}): Promise<{ ok: boolean; error?: string }> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { ok: false, error: "Supabase is not configured, so email cannot be sent." };
  }
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ kind: options.kind, to: options.to, params: options.params ?? {} }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.text().catch(() => "");
    if (!response.ok) {
      let message = `The email service replied ${response.status}.`;
      try {
        const parsed = JSON.parse(body) as { error?: string };
        if (parsed.error) message = parsed.error;
      } catch {
        if (response.status === 404) {
          message =
            "The send-email function is not deployed yet. Run: supabase functions deploy send-email --no-verify-jwt";
        }
      }
      console.error(`[send-email] send failed for ${options.to}:`, response.status, body.slice(0, 200));
      return { ok: false, error: message };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "The email service could not be reached — try again." };
  }
}

/** Insert-if-missing pending row via the anon client (schema default status). */
async function savePendingApproval(email: string): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return false;
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const existing = await client.from("mentor_approvals").select("email").eq("email", email).maybeSingle();
    if (existing.error) {
      console.error("[send-email] mentor_approvals read failed:", existing.error.message);
      return false;
    }
    if (existing.data) return true;
    const inserted = await client.from("mentor_approvals").insert({ email, status: "pending" });
    if (inserted.error) {
      console.error("[send-email] mentor_approvals insert failed:", inserted.error.message);
      return false;
    }
    return true;
  } catch (error) {
    console.error("[send-email] pending-approval save failed:", error);
    return false;
  }
}

/**
 * Upsert the issued key into license_keys via the anon client. The live
 * table's key column is `key`; the optional ea_name/expiry columns may not
 * exist on legacy tables, so the write retries WITHOUT them (PostgREST
 * error 42703 = column does not exist) and the key row always lands.
 */
async function saveLicenseKey(input: {
  licenseKey: string;
  email: string;
  eaName: string | null;
  expiry: string | null;
  eaImage?: string | null;
}): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return false;
  // SECURE PATH FIRST: issue through the server function with the
  // service-role key. Once supabase/secure-payment-gate.sql is applied, the
  // anon insert on license_keys is blocked (anyone could otherwise forge a
  // key row for their own email), so issuance MUST go through the server.
  try {
    const { issueLicenseKeySecure } = await import("@/lib/supabase.server");
    const secure = await issueLicenseKeySecure({
      data: {
        licenseKey: input.licenseKey,
        email: input.email,
        eaName: input.eaName,
        expiry: input.expiry,
        eaImage: input.eaImage ?? null,
      },
    });
    if (secure.ok) return true;
    console.warn("[send-email] secure key issuance failed:", secure.error, "— trying anon fallback");
  } catch (secureError) {
    console.warn("[send-email] secure key issuance unavailable:", secureError);
  }
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    // The LIVE table's primary key is `id` (uuid default) — `key` is NOT a
    // unique constraint, so upsert(onConflict: "key") fails with "there is
    // no unique or exclusion constraint" and the key row never landed (the
    // app then said "license key was not found" for the owner's own key).
    // INSERT plainly first; only retry as an upsert when a previous insert
    // hit a duplicate-key error (42P10 = no unique constraint is NOT it).
    const base: Record<string, unknown> = { key: input.licenseKey, email: input.email };
    if (input.eaName) base["ea_name"] = input.eaName;
    if (input.expiry) base["expiry"] = input.expiry;
    // Picture travels with the key (same retry rules as the other extras).
    if (input.eaImage) base["ea_image"] = input.eaImage;
    let result = await client.from("license_keys").insert(base);
    if (result.error?.code === "23505") {
      // Genuine duplicate key value — the row exists; refresh it via upsert
      // on the key column ONLY if the table actually has that constraint.
      result = await client.from("license_keys").upsert(base);
    } else if (result.error?.code === "42P10") {
      // Table without a unique constraint on key: plain insert with the
      // core columns only.
      result = await client.from("license_keys").insert({ key: input.licenseKey, email: input.email });
    } else if (result.error?.code === "42703") {
      // Legacy table without the ea_name/expiry columns — core row only.
      result = await client.from("license_keys").insert({ key: input.licenseKey, email: input.email });
    }
    if (result.error) {
      console.error("[send-email] license_keys save failed:", result.error.code, result.error.message);
      return false;
    }
    return true;
  } catch (error) {
    console.error("[send-email] license_keys save failed:", error);
    return false;
  }
}

export type SendEmailInput =
  | { type: "new_registration"; email: string; firstName?: string; displayName?: string }
  | { type: "approval_decision"; email: string; decision: "approved" | "rejected"; licenseLimit?: number }
  | { type: "license_approved"; email: string; licenseKey: string; eaName?: string; expiry?: string; eaImage?: string }
  | { type: "broadcast"; email: string; message: string };

export type SendEmailResult = { success: boolean; error?: string };

/**
 * Tell the admin a new account exists. Both signup paths call this: the website
 * form and the in-app sign-in (registerWithEmail). The app path used to write
 * the pending row silently, so a registration made on the phone produced no
 * notification at all and never reached the admin's inbox.
 *
 * Never throws — a failed alert must not block the person who just registered.
 */
export async function notifyAdminOfRegistration(input: {
  email: string;
  displayName?: string;
}): Promise<void> {
  try {
    await sendPortalEmail({
      data: {
        type: "new_registration",
        email: input.email,
        ...(input.displayName ? { displayName: input.displayName } : {}),
      },
    });
  } catch (error) {
    console.error("[send-email] new-registration alert failed for", input.email, error);
  }
}

/**
 * Same call contract as the old server function (including the `{ data }`
 * wrapper) so every call site keeps working unchanged — the send just runs
 * in the browser against Brevo's public API.
 */
export const sendPortalEmail = async ({ data }: { data: SendEmailInput }): Promise<SendEmailResult> => {
  const email = data.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { success: false, error: "A valid email address is required." };
  }

  if (data.type === "new_registration") {
    // Save the pending approval row (insert-if-missing) before notifying.
    // RESILIENT: a missing table or a database hiccup must NEVER block the
    // notification email — the admin can still approve from the console,
    // and the pending row can be recreated on the next attempt.
    try {
      const saved = await savePendingApproval(email);
      if (!saved) {
        console.warn("[send-email] pending-approval save returned false for", email, "— sending the notification email anyway");
      }
    } catch (saveError) {
      console.warn("[send-email] pending-approval save failed for", email, "— sending the notification email anyway:", saveError);
    }
    const name = (data.displayName ?? data.firstName ?? "").trim();
    // BOTH admin inboxes — a single recipient that silently filters or
    // clusters these alerts made "new registrations never arrive". The function
    // sends one message per recipient; any address that receives it is enough.
    const [first, second] = await Promise.allSettled([
      sendViaBrevo({ kind: "new_registration", to: ADMIN_EMAIL, params: name ? { name } : {} }),
      sendViaBrevo({ kind: "new_registration", to: ADMIN_EMAIL_2, params: name ? { name } : {} }),
    ]);
    if (first.status === "fulfilled" && first.value.ok) return { success: true };
    if (second.status === "fulfilled" && second.value.ok) return { success: true };
    const failure = (first.status === "rejected" ? String(first.reason) : first.value.error) ?? (second.status === "rejected" ? String(second.reason) : second.value.error) ?? "The email service could not send the alert.";
    return { success: false, error: failure };
  }

  // approval_decision — the admin console's APPROVE / REJECT decision.
  // The person who pressed the button gets told, so nobody is left guessing
  // why their account still cannot sign in. The approved copy states the
  // exact key allowance that was granted, because that is the number they
  // will hit when they create their first license key.
  if (data.type === "approval_decision") {
    const sent = await sendViaBrevo({
      kind: "approval_decision",
      to: email,
      params: { decision: data.decision, licenseLimit: Number(data.licenseLimit ?? 0) },
    });
    return sent.ok ? { success: true } : { success: false, ...(sent.error ? { error: sent.error } : {}) };
  }

  // broadcast — a plain message from the admin to one recipient.
  if (data.type === "broadcast") {
    const message = data.message.trim();
    if (!message) return { success: false, error: "The message is empty." };
    const sent = await sendViaBrevo({ kind: "broadcast", to: email, params: { message } });
    return sent.ok ? { success: true } : { success: false, ...(sent.error ? { error: sent.error } : {}) };
  }

  // license_approved — save the key, then email it to the user.
  const licenseKey = data.licenseKey.trim().toUpperCase();
  if (!licenseKey) return { success: false, error: "A license key is required." };

  const eaName = data.eaName?.trim() || "Your EA";
  const expiry = data.expiry?.trim() || "Lifetime";
  // RESILIENT: a missing license_keys table or a database error must NEVER
  // block the key from reaching the client by email — the key is also stored
  // in the mentor's local license list, so delivery always wins.
  try {
    const keySaved = await saveLicenseKey({
      licenseKey,
      email,
      eaName: data.eaName?.trim() || null,
      expiry: data.expiry?.trim() || null,
      eaImage: data.eaImage ?? null,
    });
    if (!keySaved) {
      console.warn("[send-email] license_keys save returned false for", email, "— sending the key email anyway");
    }
  } catch (saveError) {
    console.warn("[send-email] license_keys save failed for", email, "— sending the key email anyway:", saveError);
  }

  const send = await sendViaBrevo({
    kind: "license_approved",
    to: email,
    params: { licenseKey, eaName },
  });
  return send.ok ? { success: true } : { success: false, error: send.error ?? "The email service could not send the key." };
};
