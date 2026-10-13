/**
 * ONE MAIL SENDER, AND EVERY CALLER SURFACES ITS ERRORS.
 *
 * The Brevo era had four separate HTTP calls to the mail provider, copied into
 * four modules. They drifted: different sender names, different timeouts, four
 * different error strings. That drift is why a broken mail path can sit
 * unreported for days - each copy fails a little differently, and none of them
 * agreed on what a failure was called.
 *
 * WHAT IT ASSERTS
 *   1. No module talks to a mail provider directly. The ONLY exception is
 *      src/lib/mailjet.server.ts, which is the single point of contact.
 *   2. Every module that sends mail imports that one `sendMail`.
 *   3. Those callers return the provider's own message rather than replacing it
 *      with a generic sentence.
 *
 * This is a STATIC check - it reads the source, it sends nothing, and it needs
 * no database. It is the cheapest way to catch a second mail path appearing.
 *
 * Run: bun scripts/verify-single-mail-sender.ts
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SKIP = new Set(["node_modules", "dist", ".vercel", ".git", ".output"]);

/** The one module permitted to name a provider host. */
const THE_SENDER = "src/lib/mailjet.server.ts";

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (SKIP.has(e)) continue;
    const full = join(dir, e);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(e)) out.push(full);
  }
  return out;
}

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

/* 1. Nobody bypasses the shared sender. */
const files = [...walk("src"), ...walk("api")];
let bypasses = 0;
for (const f of files) {
  if (f === THE_SENDER) continue;
  const src = readFileSync(f, "utf8");
  // Comments are allowed to NAME a provider (they explain why one was removed);
  // only executable code is a bypass.
  const live = src
    .split("\n")
    .filter((l) => !/^\s*(\*|\/\/)/.test(l))
    .filter((l) => /api\.mailjet\.com|api\.brevo\.com|api\.sendgrid\.net|api\.resend\.com/.test(l));
  if (live.length) {
    bypasses++;
    check(`${f} has no direct provider call`, false, live.join(" | ").slice(0, 90));
  }
}
check(`no module bypasses the shared mail sender (${files.length} files scanned)`, bypasses === 0);

/* 2 & 3. Every sender imports the one client and passes its error through. */
const senders = [
  "api/activation.ts",
  "api/portal.ts",
  "src/lib/send-email.server.ts",
  "src/lib/account-sync.server.ts",
];
for (const f of senders) {
  const src = readFileSync(f, "utf8");
  // The `.js` suffix on the two api/ imports is REQUIRED (native ESM on
  // Vercel refuses extensionless relative imports — see the note in
  // api/activation.ts), so the pattern accepts the extension when present.
  check(
    `${f} routes through the shared sendMail`,
    /import\s*\{\s*sendMail\s*\}\s*from\s*"[^"]*mailjet\.server(\.js)?"/.test(src),
  );
}

const flat = (p: string) => readFileSync(p, "utf8").replace(/\s+/g, " ");

check(
  "activation returns sendMail's own error string",
  /return\s*\{\s*ok:\s*false,\s*error:\s*result\.error/.test(flat("api/activation.ts")),
);
check("portal returns sendMail's result straight through", /json\(await sendMail\(/.test(flat("api/portal.ts")));

const ses = readFileSync("src/lib/send-email.server.ts", "utf8");
check("send-email.server delegates to sendMail", /return sendMail\(options\)/.test(ses));
check("send-email.server keeps the provider message on failure", /send\.error \?\? /.test(ses));

const acc = readFileSync("src/lib/account-sync.server.ts", "utf8");
check("account-sync delegates to sendMail", /await sendMail\(options\)/.test(acc));
check(
  "account-sync logs the provider message on failure",
  /console\.error\("\[mailjet\] send failed for", options\.to, result\.error\)/.test(acc),
);

console.log(
  failures === 0
    ? "RESULT: OK — one mail sender, and every caller surfaces its errors"
    : `RESULT: ${failures} check(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);