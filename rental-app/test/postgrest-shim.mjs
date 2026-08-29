/* A small stand-in for PostgREST, over the real schema in a real Postgres.
 *
 * Why it exists: this container cannot reach *.supabase.co (egress policy), so
 * the only way to check that ptas.html actually talks to the database correctly
 * is to serve the same wire format locally. Every query below runs against the
 * real migrations with real row-level security -- it sets the role and the JWT
 * claim exactly as Supabase does -- so a policy mistake fails here too.
 *
 * It implements only the calls ptas.html makes. It is a test fixture, not a
 * PostgREST clone.
 */
import http from "node:http";
import { Pool } from "pg";

/* A pool, not a single Client. The app fires several requests at once - the
 * payment sheet asks for the receiving account and opens the order together -
 * and on one shared connection their transactions interleave: the second
 * BEGIN is swallowed, `set local` from one request lands in the other, and the
 * first COMMIT ends both. That surfaced as auth.uid() being NULL inside a
 * function, which looks exactly like an authentication bug and is not one. */
const pool = new Pool({ host: "/tmp", port: 5433, user: "pg", database: "ptas_app", max: 8 });

const json = (res, code, body) => {
  res.writeHead(code, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "GET,POST,DELETE,PATCH,OPTIONS"
  });
  res.end(JSON.stringify(body));
};

/* Supabase decides who you are from the bearer token. Here the token IS the
 * user id, which keeps the fixture honest about the thing that matters: every
 * statement runs as `authenticated` with that uid, or as `anon` without one. */
function whoami(req) {
  const auth = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  return /^[0-9a-f-]{36}$/.test(auth) ? auth : null;
}

/* Real access tokens expire. The fixture has no clock, so expiry is spelled
 * into the token itself: a bearer of "expired-<uid>" is treated as a token
 * that has run out, exactly as GoTrue would - 401, PostgREST's error shape.
 * Without this the suite could never see the recovery path, which is the one
 * that decides whether the app survives its second hour. */
function isExpired(req) {
  const auth = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  return auth.startsWith("expired-");
}

async function asRole(uid, fn) {
  const db = await pool.connect();
  try {
    await db.query("begin");
    try {
      if (uid) {
        await db.query("set local role authenticated");
        await db.query("select set_config('request.jwt.claim.sub', $1, true)", [uid]);
      } else {
        await db.query("set local role anon");
      }
      const out = await fn(db);
      await db.query("commit");
      return out;
    } catch (e) {
      await db.query("rollback");
      throw e;
    }
  } finally {
    db.release();
  }
}

/* select=*,listing_photos(path,position) -> a lateral json aggregate, which is
 * what PostgREST builds for an embedded resource. */
function selectList(select) {
  const embed = /listing_photos\(([^)]*)\)/.exec(select || "");
  if (!embed) return "l.*";
  const cols = embed[1].split(",").map(c => `'${c.trim()}', p.${c.trim()}`).join(", ");
  return `l.*, coalesce((select json_agg(json_build_object(${cols}))
            from listing_photos p where p.listing_id = l.id), '[]'::json) as listing_photos`;
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return json(res, 204, null);

  const url = new URL(req.url, "http://x");
  const uid = whoami(req);
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks);
  /* A storage upload is image bytes, not JSON. Parsing every body eagerly
   * threw outside the try below and took the whole shim down mid-request,
   * which surfaced in the browser as a socket reset rather than an error. */
  let payload = {};
  try { payload = raw.length ? JSON.parse(raw.toString("utf8")) : {}; }
  catch { payload = {}; }

  try {
    if (isExpired(req)) {
      return json(res, 401, { message: "JWT expired", code: "PGRST301" });
    }

    if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "refresh_token") {
      const uid = String(payload.refresh_token || "").replace(/^r-/, "");
      if (!/^[0-9a-f-]{36}$/.test(uid)) return json(res, 400, { message: "bad refresh token" });
      return json(res, 200, {
        access_token: uid, refresh_token: "r-" + uid, expires_in: 3600,
        user: { id: uid },
      });
    }

    /* Auth. The real thing sends an SMS; there is nothing to send here, so the
     * code is always 000000 and the token is the user id. What this fixture
     * has to get right is not the credential but the identity: every query
     * after this runs as that uid, under the real policies. */
    if (url.pathname === "/auth/v1/otp") {
      return json(res, 200, {});
    }

    /* The dev-signin edge function, standing in for the real one. Same
     * contract: a phone number in, a session out, nothing verified. */
    if (url.pathname === "/functions/v1/dev-signin") {
      const digits = String(payload.phone || "").replace(/[^0-9]/g, "");
      const phone = "+855" + (digits.startsWith("855") ? digits.slice(3) : digits.replace(/^0+/, ""));
      const r = await pool.query(
        `insert into auth.users (id, phone) values (gen_random_uuid(), $1)
         on conflict (phone) do update set phone = excluded.phone
         returning id`, [phone]);
      const id = r.rows[0].id;
      return json(res, 200, { access_token: id, refresh_token: "r-" + id,
                              expires_in: 3600, user: { id, phone } });
    }

    if (url.pathname === "/auth/v1/verify") {
      if (payload.token !== "000000") return json(res, 400, { message: "Token has expired or is invalid" });
      const r = await pool.query(
        `insert into auth.users (id, phone) values (gen_random_uuid(), $1)
         on conflict (phone) do update set phone = excluded.phone
         returning id`, [payload.phone]);
      const id = r.rows[0].id;
      return json(res, 200, { access_token: id, refresh_token: "r-" + id,
                              expires_in: 3600, user: { id, phone: payload.phone } });
    }

    if (url.pathname.startsWith("/storage/v1/object/")) {
      /* Storage is not what these tests are about, and the policies on it are
       * asserted in SQL. Accept the bytes and report the path. */
      return json(res, 200, { Key: url.pathname.replace("/storage/v1/object/", "") });
    }

    if (url.pathname === "/rest/v1/profiles" && req.method === "GET") {
      const id = (url.searchParams.get("id") || "").replace("eq.", "");
      const r = await asRole(uid, (db) => db.query("select * from profiles where id = $1", [id]));
      return json(res, 200, r.rows);
    }

    if (url.pathname === "/rest/v1/reports" && req.method === "POST") {
      await asRole(uid, (db) => db.query(
        "insert into reports (listing_id, reporter_id, reason) values ($1,$2,$3)",
        [payload.listing_id, payload.reporter_id, payload.reason]));
      return json(res, 201, []);
    }

    if (url.pathname === "/rest/v1/listing_photos" && req.method === "POST") {
      await asRole(uid, (db) => db.query(
        "insert into listing_photos (listing_id, path, position) values ($1,$2,$3)",
        [payload.listing_id, payload.path, payload.position]));
      return json(res, 201, []);
    }

    if (url.pathname === "/rest/v1/saved_searches" && req.method === "GET") {
      const renter = (url.searchParams.get("renter_id") || "").replace("eq.", "");
      const r = await asRole(uid, (db) => db.query(
        "select * from saved_searches where renter_id = $1 order by created_at desc", [renter]));
      return json(res, 200, r.rows);
    }

    if (url.pathname === "/rest/v1/saved_searches" && req.method === "POST") {
      const cols = Object.keys(payload);
      const r = await asRole(uid, (db) => db.query(
        `insert into saved_searches (${cols.join(",")})
         values (${cols.map((_, i) => "$" + (i + 1)).join(",")}) returning *`,
        cols.map(c => payload[c])));
      return json(res, 201, r.rows);
    }

    if (url.pathname === "/rest/v1/saved_searches" && req.method === "DELETE") {
      const id = (url.searchParams.get("id") || "").replace("eq.", "");
      await asRole(uid, (db) => db.query("delete from saved_searches where id = $1", [id]));
      return json(res, 204, null);
    }

    if (url.pathname === "/rest/v1/payment_orders" && req.method === "GET") {
      const r = await asRole(uid, (db) => db.query(
        `select o.*,
                json_build_object('title', l.title, 'contact_phone', l.contact_phone) as listings,
                coalesce((select json_agg(json_build_object(
                            'storage_path', p.storage_path,
                            'claimed_tx_reference', p.claimed_tx_reference,
                            'superseded', p.superseded))
                          from payment_proofs p where p.order_id = o.id), '[]'::json) as payment_proofs
           from payment_orders o join listings l on l.id = o.listing_id
          where o.state = 'submitted' order by o.created_at`));
      return json(res, 200, r.rows);
    }

    if (url.pathname === "/rest/v1/tenancies" && req.method === "GET") {
      const r = await asRole(uid, (db) => db.query(
        `select t.*, row_to_json(l.*) as listings
           from tenancies t join listings l on l.id = t.listing_id
          where t.ended_at is null order by t.created_at desc limit 1`));
      return json(res, 200, r.rows);
    }

    if (url.pathname === "/rest/v1/districts") {
      const r = await asRole(uid, (db) => db.query("select * from districts order by position"));
      return json(res, 200, r.rows);
    }

    if (url.pathname === "/rest/v1/rpc/search_listings") {
      const r = await asRole(uid, (db) => db.query(
        `select ${selectList("*,listing_photos(path,position)")}
           from search_listings(p_limit => $1) l`, [payload.p_limit || 30]));
      return json(res, 200, r.rows);
    }

    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      const fn = url.pathname.split("/").pop();
      const keys = Object.keys(payload);
      const args = keys.map((k, i) => `${k} => $${i + 1}`).join(", ");
      const r = await asRole(uid, (db) =>
        db.query(`select * from ${fn}(${args})`, keys.map(k => payload[k])));
      const row = r.rows[0] ?? null;
      /* PostgREST unwraps a scalar-returning function: is_admin() comes back
       * as `false`, not `{ is_admin: false }`. Returning the row object made
       * every caller look like an admin to `!!`, which is the kind of fixture
       * bug that hides a real one. */
      const single = row && Object.keys(row).length === 1 && r.fields.length === 1;
      return json(res, 200, single ? row[r.fields[0].name] : row);
    }

    if (url.pathname === "/rest/v1/listings" && req.method === "GET") {
      const owner = (url.searchParams.get("owner_id") || "").replace("eq.", "");
      const r = await asRole(uid, (db) => db.query(
        `select ${selectList(url.searchParams.get("select"))} from listings l
          where ($1 = '' or l.owner_id::text = $1) order by l.created_at desc`, [owner]));
      return json(res, 200, r.rows);
    }

    if (url.pathname === "/rest/v1/listings" && req.method === "PATCH") {
      const id = (url.searchParams.get("id") || "").replace("eq.", "");
      const cols = Object.keys(payload);
      await asRole(uid, (db) => db.query(
        `update listings set ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")} where id = $1`,
        [id, ...cols.map(c => payload[c])]));
      return json(res, 204, null);
    }

    if (url.pathname === "/rest/v1/listings" && req.method === "POST") {
      const cols = Object.keys(payload);
      const r = await asRole(uid, (db) => db.query(
        `with ins as (insert into listings (${cols.join(",")})
                      values (${cols.map((_, i) => "$" + (i + 1)).join(",")}) returning *)
         select ${selectList(url.searchParams.get("select"))} from ins l`,
        cols.map(c => payload[c])));
      return json(res, 201, r.rows);
    }

    if (url.pathname === "/rest/v1/saved" && req.method === "POST") {
      await asRole(uid, (db) => db.query(
        "insert into saved (renter_id, listing_id) values ($1,$2) on conflict do nothing",
        [payload.renter_id, payload.listing_id]));
      return json(res, 201, []);
    }

    if (url.pathname === "/rest/v1/saved" && req.method === "DELETE") {
      const renter = (url.searchParams.get("renter_id") || "").replace("eq.", "");
      const listing = (url.searchParams.get("listing_id") || "").replace("eq.", "");
      await asRole(uid, (db) => db.query(
        "delete from saved where renter_id = $1 and listing_id = $2", [renter, listing]));
      return json(res, 204, null);
    }

    if (url.pathname === "/rest/v1/saved" && req.method === "GET") {
      const renter = (url.searchParams.get("renter_id") || "").replace("eq.", "");
      const r = await asRole(uid, (db) => db.query(
        "select listing_id from saved where renter_id = $1", [renter]));
      return json(res, 200, r.rows);
    }

    if (url.pathname === "/rest/v1/reports" && req.method === "POST") {
      await asRole(uid, (db) => db.query(
        "insert into reports (listing_id, reporter_id, reason) values ($1,$2,$3)",
        [payload.listing_id, payload.reporter_id, payload.reason]));
      return json(res, 201, []);
    }

    if (url.pathname === "/rest/v1/receiving_accounts") {
      const r = await asRole(uid, (db) =>
        db.query("select * from receiving_accounts where is_active"));
      return json(res, 200, r.rows);
    }

    return json(res, 404, { message: "no route " + url.pathname });
  } catch (e) {
    /* PostgREST surfaces a raised plpgsql message under .message, and so must
     * this, because the app shows it to the user. */
    return json(res, 400, { message: e.message });
  }
});

server.listen(54321, () => console.log("shim on 54321"));
