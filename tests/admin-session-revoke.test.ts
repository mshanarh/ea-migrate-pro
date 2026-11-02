/**
 * THE SCOPED LOGOUT — "sign the sole admin out of every device".
 *
 * The app's session lives in device storage, so a bump of ADMIN_SESSION_EPOCH
 * is what a remote logout can actually act on. These assertions pin the three
 * properties that make it safe to ship:
 *
 *   1. the admin's session is revoked exactly ONCE per device per epoch,
 *   2. every other email is untouched — this is not a global logout,
 *   3. a device that applied the revocation while somebody else was signed in
 *      must NOT kick the admin who signs in afterwards.
 */

import {
  ADMIN_SESSION_EMAILS,
  ADMIN_SESSION_EPOCH,
  ADMIN_SESSION_EPOCH_KEY,
  adminSessionRevoked,
  isSoleAdminSession,
} from "../src/lib/admin-session";

const ADMIN = "biyasentobeko222@gmail.com";

describe("isSoleAdminSession", () => {
  it("recognises the sole admin, its bare-domain variant and nothing else", () => {
    expect(isSoleAdminSession(ADMIN)).toBe(true);
    expect(isSoleAdminSession("  BiyaseNtobeko222@Gmail.com ")).toBe(true);
    expect(isSoleAdminSession("biyasentobeko222@gmail")).toBe(true);
    expect(isSoleAdminSession("client@example.com")).toBe(false);
    expect(isSoleAdminSession("")).toBe(false);
    expect(isSoleAdminSession(null)).toBe(false);
  });

  it("holds exactly the admin pair", () => {
    expect([...ADMIN_SESSION_EMAILS]).toEqual([ADMIN, "biyasentobeko222@gmail"]);
  });
});

describe("adminSessionRevoked", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("revokes the admin's session once, then records the epoch", () => {
    expect(adminSessionRevoked(ADMIN)).toBe(true);
    expect(window.localStorage.getItem(ADMIN_SESSION_EPOCH_KEY)).toBe(String(ADMIN_SESSION_EPOCH));
    // The admin must be able to sign back in and stay signed in.
    expect(adminSessionRevoked(ADMIN)).toBe(false);
  });

  it("never revokes anybody else's session", () => {
    expect(adminSessionRevoked("client@example.com")).toBe(false);
    expect(adminSessionRevoked(null)).toBe(false);
    // …and that device is stamped, so it is not waiting to kick the admin later.
    expect(window.localStorage.getItem(ADMIN_SESSION_EPOCH_KEY)).toBe(String(ADMIN_SESSION_EPOCH));
  });

  it("does not kick an admin who signs in after the device already applied it", () => {
    adminSessionRevoked("client@example.com"); // device boots with another account
    expect(adminSessionRevoked(ADMIN)).toBe(false);
  });

  it("is a no-op once this device has seen the epoch", () => {
    window.localStorage.setItem(ADMIN_SESSION_EPOCH_KEY, String(ADMIN_SESSION_EPOCH));
    expect(adminSessionRevoked(ADMIN)).toBe(false);
  });

  it("applies again only when the shipped epoch is bumped", () => {
    window.localStorage.setItem(ADMIN_SESSION_EPOCH_KEY, String(ADMIN_SESSION_EPOCH - 1));
    expect(adminSessionRevoked(ADMIN)).toBe(true);
  });
});
