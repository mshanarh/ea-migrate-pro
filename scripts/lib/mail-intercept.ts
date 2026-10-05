/**
 * Shared test double for the app's mail path, used by the offline probe suites.
 *
 * WHY THIS EXISTS RATHER THAN STUBBING `fetch`
 * ────────────────────────────────────────────
 * The probe scripts used to wrap `globalThis.fetch` and answer any request to
 * `api.brevo.com` locally, which is why they could prove "a code was mailed"
 * without putting a message in a real inbox. That trick BREAKS with Mailjet:
 *
 *   `node-mailjet` sends through AXIOS, and in a Node runtime axios selects its
 *   **http** adapter, not its fetch adapter. Verified directly: with
 *   `globalThis.fetch` replaced by a recording stub, a Mailjet send produced
 *   **zero** stub calls and went to the real host instead.
 *
 * So a fetch stub would silently stop intercepting. The probe would still
 * print PASS while actually sending mail — which is worse than no probe at all,
 * because it would be trusted.
 *
 * This helper replaces the MODULE instead, at the boundary every caller
 * actually uses (`src/lib/mailjet.server.ts`). It is transport-agnostic: it
 * keeps working whatever HTTP client the provider SDK uses internally.
 *
 * It also asserts the module can be intercepted at all. If a future refactor
 * bypasses `sendMail`, `assertInterceptable()` fails loudly rather than letting
 * the suite quietly start sending real mail.
 */
import { mock } from "bun:test";

export type Captured = { to: string; subject: string; html: string; text: string };

const captured: Captured[] = [];

/** Install the double. Call BEFORE importing the module under test. */
export function interceptMail(): void {
  mock.module("../../src/lib/mailjet.server", () => ({
    sendMail: async (m: Captured) => {
      captured.push({ to: m.to, subject: m.subject, html: m.html, text: m.text });
      return { ok: true } as const;
    },
    mailConfigured: () => true,
    mailSender: () => "probe@eamigratepro.invalid",
  }));
}

/** Every message the code under test tried to send, in order. */
export function sentMessages(): Captured[] {
  return captured;
}

/**
 * Prove the double is actually in place.
 *
 * A probe that cannot intercept will send REAL mail while reporting success, so
 * this is checked before any assertion is trusted.
 */
export async function assertInterceptable(): Promise<void> {
  const mod = (await import("../../src/lib/mailjet.server")) as {
    sendMail: (m: Captured) => Promise<unknown>;
  };
  const before = captured.length;
  await mod.sendMail({
    to: "intercept-selftest@eamigratepro.invalid",
    subject: "selftest",
    html: "selftest",
    text: "selftest",
  });
  if (captured.length !== before + 1) {
    throw new Error(
      "MAIL INTERCEPTION FAILED: the mail module was not replaced, so this probe would send REAL email while reporting PASS. Fix the import path in interceptMail().",
    );
  }
  captured.length = before;
}