/** POST /api/register — stores a new mentor registration as "pending". */
import {
  createRegistration,
  hashPassword,
  isAdminEmail,
  normalizeEmail,
  parseBody,
  type ApiRequest,
  type ApiResponse,
  type Registration,
} from "./_registry.js";

function field(body: Record<string, unknown>, key: string, max = 120): string {
  const value = body[key];
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export default async function handler(request: ApiRequest, response: ApiResponse): Promise<void> {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }
  const body = parseBody(request);
  const email = normalizeEmail(body["email"]);
  const password = typeof body["password"] === "string" ? body["password"] : "";
  if (!/^[^\s@]+@[^\s@]+$/.test(email) || email.length > 254) {
    response.status(400).json({ ok: false, error: "Enter a valid email address." });
    return;
  }
  if (password.length < 6 || password.length > 200) {
    response.status(400).json({ ok: false, error: "Password must be at least 6 characters." });
    return;
  }
  const firstName = field(body, "firstName");
  const displayName = field(body, "displayName");
  const username = field(body, "username");
  const whatsapp = field(body, "whatsapp", 40);
  if (!firstName || !displayName || !username || !whatsapp) {
    response.status(400).json({ ok: false, error: "Please fill in every field." });
    return;
  }

  const { hash, salt } = hashPassword(password);
  const now = new Date().toISOString();
  const owner = isAdminEmail(email);
  const record: Registration = {
    email,
    firstName,
    displayName,
    username,
    whatsapp,
    passwordHash: hash,
    passwordSalt: salt,
    createdAt: now,
    updatedAt: now,
    status: owner ? "approved" : "pending",
    isPaid: false,
    paidAt: null,
    licenseLimit: owner ? 2000 : 0,
  };

  try {
    const created = await createRegistration(record);
    if (!created) {
      response.status(409).json({ ok: false, error: "That email is already registered." });
      return;
    }
    response.status(201).json({ ok: true, status: record.status });
  } catch (error) {
    console.error("[register]", error);
    response.status(503).json({ ok: false, error: "Registration storage is unavailable. Please try again." });
  }
}
