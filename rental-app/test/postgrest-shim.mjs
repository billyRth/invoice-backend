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
import { Client } from "pg";

const db = new Client({ host: "/tmp", port: 5433, user: "pg", database: "ptas_app" });
await db.connect();

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

async function asRole(uid, fn) {
  await db.query("begin");
  try {
    if (uid) {
      await db.query("set local role authenticated");
      await db.query("select set_config('request.jwt.claim.sub', $1, true)", [uid]);
    } else {
      await db.query("set local role anon");
    }
    const out = await fn();
    await db.query("commit");
    return out;
  } catch (e) {
    await db.query("rollback");
    throw e;
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
  let body = "";
  for await (const chunk of req) body += chunk;
  const payload = body ? JSON.parse(body) : {};

  try {
    if (url.pathname === "/rest/v1/districts") {
      const r = await asRole(uid, () => db.query("select * from districts order by position"));
      return json(res, 200, r.rows);
    }

    if (url.pathname === "/rest/v1/rpc/search_listings") {
      const r = await asRole(uid, () => db.query(
        `select ${selectList("*,listing_photos(path,position)")}
           from search_listings(p_limit => $1) l`, [payload.p_limit || 30]));
      return json(res, 200, r.rows);
    }

    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      const fn = url.pathname.split("/").pop();
      const keys = Object.keys(payload);
      const args = keys.map((k, i) => `${k} => $${i + 1}`).join(", ");
      const r = await asRole(uid, () =>
        db.query(`select * from ${fn}(${args})`, keys.map(k => payload[k])));
      return json(res, 200, r.rows[0] || null);
    }

    if (url.pathname === "/rest/v1/listings" && req.method === "GET") {
      const owner = (url.searchParams.get("owner_id") || "").replace("eq.", "");
      const r = await asRole(uid, () => db.query(
        `select ${selectList(url.searchParams.get("select"))} from listings l
          where ($1 = '' or l.owner_id::text = $1) order by l.created_at desc`, [owner]));
      return json(res, 200, r.rows);
    }

    if (url.pathname === "/rest/v1/listings" && req.method === "POST") {
      const cols = Object.keys(payload);
      const r = await asRole(uid, () => db.query(
        `with ins as (insert into listings (${cols.join(",")})
                      values (${cols.map((_, i) => "$" + (i + 1)).join(",")}) returning *)
         select ${selectList(url.searchParams.get("select"))} from ins l`,
        cols.map(c => payload[c])));
      return json(res, 201, r.rows);
    }

    if (url.pathname === "/rest/v1/saved" && req.method === "POST") {
      await asRole(uid, () => db.query(
        "insert into saved (renter_id, listing_id) values ($1,$2) on conflict do nothing",
        [payload.renter_id, payload.listing_id]));
      return json(res, 201, []);
    }

    if (url.pathname === "/rest/v1/saved" && req.method === "DELETE") {
      const renter = (url.searchParams.get("renter_id") || "").replace("eq.", "");
      const listing = (url.searchParams.get("listing_id") || "").replace("eq.", "");
      await asRole(uid, () => db.query(
        "delete from saved where renter_id = $1 and listing_id = $2", [renter, listing]));
      return json(res, 204, null);
    }

    if (url.pathname === "/rest/v1/saved" && req.method === "GET") {
      const renter = (url.searchParams.get("renter_id") || "").replace("eq.", "");
      const r = await asRole(uid, () => db.query(
        "select listing_id from saved where renter_id = $1", [renter]));
      return json(res, 200, r.rows);
    }

    if (url.pathname === "/rest/v1/reports" && req.method === "POST") {
      await asRole(uid, () => db.query(
        "insert into reports (listing_id, reporter_id, reason) values ($1,$2,$3)",
        [payload.listing_id, payload.reporter_id, payload.reason]));
      return json(res, 201, []);
    }

    if (url.pathname === "/rest/v1/receiving_accounts") {
      const r = await asRole(uid, () =>
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
