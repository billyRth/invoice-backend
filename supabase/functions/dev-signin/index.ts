// Ptas — sign in with a phone number and no verification.
//
// THIS VERIFIES NOTHING. Anyone can sign in as any number. It exists so the
// whole flow — post, pay, confirm, report — can be walked and shown to people
// before there is an SMS provider to pay for, and it must not survive contact
// with real money or real landlords.
//
// Why it exists at all: real phone sign-in needs Twilio (about $0.03 a code),
// and every alternative that needs no provider — anonymous sign-in, phone with
// confirmation off — needs somebody to flip a switch in the Supabase
// dashboard. This needs nothing switched on: it maps a phone number onto an
// ordinary email identity, which is enabled by default, and hands back a real
// session. Everything downstream — RLS, auth.uid(), the ownership guards — is
// exactly what it will be in production.
//
// To retire it: delete this function and set PTAS.devAuth to false in
// ptas.html. The client's requestCode/verifyCode already speak real OTP.

const URL_BASE = Deno.env.get("SUPABASE_URL")!;
const SERVICE  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });

/** 012 345 678 and +85512345678 are the same person. The leading zero is a
 *  national trunk prefix and is dropped; getting this wrong creates two
 *  accounts for one landlord. */
function e164(input: string): string | null {
  const d = String(input || "").replace(/[^0-9]/g, "");
  if (!d) return null;
  const national = d.startsWith("855") ? d.slice(3) : d.replace(/^0+/, "");
  if (national.length < 8 || national.length > 9) return null;
  return "+855" + national;
}

/** A deterministic password, so the same number signs back into the same
 *  account rather than colliding on a duplicate-email error. Derived from the
 *  service key, which never leaves the function. */
async function passwordFor(phone: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(SERVICE),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("ptas:" + phone));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}

const admin = (path: string, init: RequestInit) =>
  fetch(URL_BASE + path, {
    ...init,
    headers: {
      apikey: SERVICE,
      authorization: "Bearer " + SERVICE,
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ message: "POST only" }, 405);

  let phone: string | null = null;
  try { phone = e164((await req.json()).phone); } catch { /* falls through */ }
  if (!phone) return json({ message: "That number does not look like a Cambodian phone number." }, 400);

  const email = "p" + phone.replace("+", "") + "@ptas.local";
  const password = await passwordFor(phone);

  // Signing in first means the common case — somebody coming back — is one call.
  let res = await admin("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const made = await admin("/auth/v1/admin/users", {
      method: "POST",
      body: JSON.stringify({
        email, password,
        email_confirm: true,
        phone,                       // the real identity, for when OTP replaces this
        user_metadata: { phone, dev_signin: true },
      }),
    });
    if (!made.ok) {
      const why = await made.text();
      return json({ message: "could not create the account", detail: why }, 400);
    }
    res = await admin("/auth/v1/token?grant_type=password", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) return json({ message: "created the account but could not sign in" }, 400);
  }

  const session = await res.json();

  // profiles.phone comes from auth.users.phone via the signup trigger, but a
  // user created by the admin API can race it. Setting it here is idempotent.
  await admin("/rest/v1/profiles?id=eq." + session.user.id, {
    method: "PATCH",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ phone }),
  });

  // The refresh token matters as much as the access one: without it the app
  // has an hour of life and then every call, browsing included, carries a dead
  // credential. Passing the whole shape through also means the client has one
  // way of reading a session, whichever endpoint produced it.
  return json({
    access_token:  session.access_token,
    refresh_token: session.refresh_token,
    expires_in:    session.expires_in,
    expires_at:    session.expires_at,
    user:          session.user,
  });
});
