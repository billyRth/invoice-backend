// Ptas — drains the notification outbox to Telegram.
//
// Messages are written by database triggers, in the same transaction as the
// thing they are about. This sends them. The separation is the point: pausing
// a listing must not depend on an API in another country being reachable, and
// a send that fails must be retryable without re-running the trigger.
//
// Called by pg_cron every few minutes. Sends nothing, and says so plainly, if
// there is no bot token configured yet.

const URL_BASE = Deno.env.get("SUPABASE_URL")!;
const SERVICE  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT      = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const APP_URL  = Deno.env.get("PTAS_APP_URL") ?? "";

const BATCH = 40;
const GIVE_UP_AFTER = 5;

const rest = (path: string, init: RequestInit = {}) =>
  fetch(URL_BASE + "/rest/v1" + path, {
    ...init,
    headers: {
      apikey: SERVICE,
      authorization: "Bearer " + SERVICE,
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));

/** Khmer, because the people receiving these are Khmer. The English is there
 *  for the handful of listings posted in English and for reading the logs. */
function compose(kind: string, p: Record<string, unknown>): string {
  const title = esc(p.title);
  const link = APP_URL ? `\n${APP_URL}` : "";
  switch (kind) {
    case "reported":
      return p.why === "no_answer"
        ? `📵 <b>${title}</b>\nអ្នកជួលច្រើននាក់ហៅមិនលាន់។ ការផ្សាយត្រូវផ្អាកទុកសិន។ បើនៅទំនេរ សូមចុច «នៅទំនេរ» ដើម្បីបង្ហាញឡើងវិញ។${link}`
        : `🔕 <b>${title}</b>\nមានអ្នករាយការណ៍ថាបន្ទប់នេះជួលរួចហើយ។ ការផ្សាយត្រូវផ្អាកទុកសិន។ បើនៅទំនេរ សូមចុច «នៅទំនេរ»។${link}`;
    case "expiring":
      return p.trial
        ? `⏳ <b>${title}</b>\nការសាកល្បងឥតគិតថ្លៃជិតផុតកំណត់។ បង់ $1 ដើម្បីឲ្យការផ្សាយបន្តបង្ហាញ។${link}`
        : `⏳ <b>${title}</b>\nខែនេះជិតផុតកំណត់។ បង់ $1 ដើម្បីឲ្យការផ្សាយបន្តបង្ហាញ។${link}`;
    case "search_match":
      return `🏠 <b>${title}</b>\n$${esc(p.price)} ក្នុងមួយខែ · ${esc(p.district)}\nមានបន្ទប់ថ្មីត្រូវនឹងអ្វីដែលអ្នកកំពុងរក។${link}`;
    case "payment_approved":
      return `✅ <b>${title}</b>\nទទួលបានការបង់ប្រាក់រួចរាល់។ ការផ្សាយកំពុងបង្ហាញហើយ។${link}`;
    case "payment_rejected":
      return `❌ <b>${title}</b>\nយើងរកមិនឃើញការផ្ទេរប្រាក់នេះទេ។ ${esc(p.reason ?? "")}${link}`;
    default:
      return title;
  }
}

Deno.serve(async () => {
  if (!BOT) {
    return new Response(
      JSON.stringify({ sent: 0, note: "TELEGRAM_BOT_TOKEN is not set; nothing was sent" }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }

  // Only messages for people who have actually linked Telegram. The rest wait:
  // if somebody links next week, everything queued for them arrives then.
  const res = await rest(
    "/notifications?select=id,kind,payload,attempts,profiles!inner(telegram_chat_id)" +
    "&sent_at=is.null&attempts=lt." + GIVE_UP_AFTER +
    "&profiles.telegram_chat_id=not.is.null&order=created_at.asc&limit=" + BATCH,
  );
  if (!res.ok) {
    return new Response(JSON.stringify({ error: await res.text() }), { status: 500 });
  }

  const rows = await res.json() as Array<{
    id: string; kind: string; payload: Record<string, unknown>;
    attempts: number; profiles: { telegram_chat_id: number };
  }>;

  let sent = 0, failed = 0;

  for (const row of rows) {
    try {
      const tg = await fetch(`https://api.telegram.org/bot${BOT}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: row.profiles.telegram_chat_id,
          text: compose(row.kind, row.payload),
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
      });

      if (tg.ok) {
        await rest("/notifications?id=eq." + row.id, {
          method: "PATCH", headers: { prefer: "return=minimal" },
          body: JSON.stringify({ sent_at: new Date().toISOString() }),
        });
        sent++;
      } else {
        const why = (await tg.text()).slice(0, 400);
        // 403 means the person blocked the bot. Retrying will never work, so
        // it is retired rather than left to burn attempts for a week.
        const dead = tg.status === 403;
        await rest("/notifications?id=eq." + row.id, {
          method: "PATCH", headers: { prefer: "return=minimal" },
          body: JSON.stringify({
            attempts: dead ? GIVE_UP_AFTER : row.attempts + 1,
            last_error: why,
          }),
        });
        failed++;
      }
    } catch (e) {
      await rest("/notifications?id=eq." + row.id, {
        method: "PATCH", headers: { prefer: "return=minimal" },
        body: JSON.stringify({ attempts: row.attempts + 1, last_error: String(e).slice(0, 400) }),
      });
      failed++;
    }
  }

  return new Response(JSON.stringify({ sent, failed, looked_at: rows.length }),
    { headers: { "content-type": "application/json" } });
});
