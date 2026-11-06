import { readFile } from "node:fs/promises";
import { transform } from "esbuild";
import assert from "node:assert/strict";
const source = (
  await readFile(
    new URL("../supabase/functions/manage-users/index.ts", import.meta.url),
    "utf8",
  )
).replace(
  /import \{ createClient \} from "[^"]+";/,
  "const createClient=deps.createClient;",
);
const { code } = await transform(source, { loader: "ts", format: "esm" });
async function request(
  body,
  {
    role = "management", active = true, reserveError = null,
    signedIn = true, revoked = false, mustChangePassword = false,
    mailError = null, passwordAccepted = true, passwordErrorCode = null, passwordStatus = 422,
  } = {},
) {
  let handler;
  const events = [];
  const record = (name, value) => {
    events.push({ name, value });
    return { error: null };
  };
  const service = {
    auth: {
      admin: {
        inviteUserByEmail: async (email) => {
          record("mail", email);
          return { data: { user: mailError ? null : { id: "invited" } }, error: mailError };
        },
        updateUserById: async (...args) => record("admin-update", args),
      },
    },
    from: (table) => ({
      insert: async (value) => record(`insert:${table}`, value),
      update: (value) => ({ eq: async () => record(`update:${table}`, value) }),
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: {
              id: "other",
              email: "other@test.invalid",
              app_role: "management",
            },
            error: null,
          }),
        }),
      }),
    }),
  };
  const caller = {
    auth: {
      getUser: async () => ({
        data: { user: signedIn ? { id: "self", email: "self@test.invalid" } : null },
        error: null,
      }),
      updateUser: async (value) => record("self-password", value),
    },
    rpc: async (name) =>
      name === "account_status"
        ? {
            data: revoked ? null : {
              id: "self",
              app_role: role,
              is_active: active,
              is_deleted: false,
              must_change_password: mustChangePassword,
            },
            error: null,
          }
        : { data: "reservation", error: reserveError },
  };
  let clients = 0;
  new Function("Deno", "deps", "fetch", code)(
    { env: { get: () => "test-runtime" }, serve: (fn) => (handler = fn) },
    { createClient: () => (clients++ === 0 ? service : caller) },
    async (url, options) => {
      assert.equal(url, "test-runtime/auth/v1/user");
      assert.equal(options.headers.Authorization, "Bearer test");
      record("self-password", JSON.parse(options.body));
      return { ok: passwordAccepted, status: passwordAccepted ? 200 : passwordStatus,
        json: async () => ({ code: passwordErrorCode, msg: "untrusted upstream message" }) };
    },
  );
  const res = await handler(
    new Request("https://test.invalid", {
      method: "POST",
      headers: {
        Authorization: "Bearer test",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: await res.json(), events };
}
for (const role of ["management", "admin"]) {
  for (const action of ["reset", "create"]) {
    const r = await request(
      { action, id: "other", password: "never-send-this-password" },
      { role },
    );
    assert.equal(r.status, 403);
    assert.equal(r.events.length, 0);
  }
  const other = await request(
    { action: "password", id: "other", password: "never-send-this-password" },
    { role },
  );
  assert.equal(other.status, 403);
  assert.equal(other.events.length, 0);
  const own = await request(
    { action: "password", password: "a-new-self-password" },
    { role },
  );
  assert.equal(own.status, 200);
  assert.ok(own.events.some((e) => e.name === "self-password"));
  assert.ok(!own.events.some((e) => e.name === "admin-update"));
  const invite = await request(
    { action: "invite", email: "New@Test.Invalid", app_role: "admin" },
    { role },
  );
  assert.equal(invite.status, 200);
  const user = invite.events.find((e) => e.name === "insert:tUser").value;
  assert.equal(user.app_role, "management");
  assert.equal(user.created_by, "self");
  assert.equal(user.must_change_password, true);
  assert.ok(!JSON.stringify(invite.body).includes("password"));
}
const blocked = await request(
  { action: "invite", email: "new@test.invalid" },
  { reserveError: { message: "Admin has paused new account invitations" } },
);
assert.equal(blocked.status, 400);
assert.equal(blocked.events.length, 0);
const disabled = await request(
  { action: "invite", email: "new@test.invalid" },
  { active: false },
);
assert.equal(disabled.status, 403);
assert.equal(disabled.events.length, 0);
for (const [options, status] of [
  [{ signedIn: false }, 401],
  [{ revoked: true }, 403],
  [{ mustChangePassword: true }, 403],
]) {
  const result = await request({ action: "invite", email: "new@test.invalid" }, options);
  assert.equal(result.status, status);
  assert.equal(result.events.length, 0, "denied caller cannot send mail or write accounts");
}
const failedMail = await request(
  { action: "invite", email: "new@test.invalid" },
  { mailError: { message: "SMTP unavailable" } },
);
assert.equal(failedMail.status, 400);
assert.ok(failedMail.events.some(e => e.name === "update:tInvitation" && e.value.status === "failed"));
assert.ok(!failedMail.events.some(e => e.name === "insert:tUser"), "failed delivery must not provision app access");
const failedPassword = await request(
  { action: "password", password: "a-new-self-password" },
  { mustChangePassword: true, passwordAccepted: false },
);
assert.equal(failedPassword.status, 400);
assert.ok(!failedPassword.events.some(e => e.name === "update:tUser"), "rejected password must not clear first-password gate");
for (const [code, status, expected] of [
  ["same_password", 422, /different from your current password/],
  ["weak_password", 422, /6–128 characters/],
  ["unknown_error", 401, /session has expired/],
  ["unknown_error", 500, /try again shortly/],
]) {
  const result = await request({ action: "password", password: "a-new-self-password" },
    { passwordAccepted: false, passwordErrorCode: code, passwordStatus: status });
  assert.equal(result.status, 400);
  assert.match(result.body.error, expected);
  assert.ok(!result.body.error.includes("untrusted upstream message"));
  assert.ok(!result.events.some(e => e.name === "update:tUser"));
}
const firstPassword = await request(
  { action: "password", password: "a-new-self-password" },
  { mustChangePassword: true },
);
assert.equal(firstPassword.status, 200);
assert.ok(firstPassword.events.some(e => e.name === "update:tUser" && e.value.must_change_password === false));
for (const password of ["abcdef", "123456", "a b c "]) {
  const result = await request({ action: "password", password });
  assert.equal(result.status, 200, "six characters need no particular character types");
  assert.equal(result.events.find(e => e.name === "self-password").value.password, password);
}
for (const password of ["", "abcde", "a".repeat(129)]) {
  const result = await request({ action: "password", password });
  assert.equal(result.status, 400);
  assert.match(result.body.error, /6–128 characters/);
  assert.equal(result.events.length, 0);
}
console.log(
  "PASS: manager/Admin invitations, forced Management role, caller/session/password gates, failed delivery, and self-only password changes with legacy resets denied.",
);
