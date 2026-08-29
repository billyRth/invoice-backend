// Ptas — linking a Telegram account to a Ptas account.
//
// Telegram will not let a bot message somebody who has not messaged it first,
// so linking has to start from the person. The app opens
// t.me/<bot>?start=<token>, Telegram delivers that token here with the chat id
// attached, and the two are joined up.
//
// The token is a per-profile random string, not the profile id: a profile id
// leaking into a URL somebody pastes into a group chat would be worse than a
// token that only does this one thing.
//
// verify_jwt is off because Telegram is the caller and has no Supabase
// session. The shared secret below is what makes the endpoint safe: Telegram
// sends it in a header it was told to use when the webhook was registered.

const URL_BASE = Deno.env.get("SUPABASE_URL")!;
const SERVICE  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT      = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const HOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "";

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

async function say(chatId: number, text: string) {
  if (!BOT) return;
  await fetch(`https://api.telegram.org/bot${BOT}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML",
                           disable_web_page_preview: true }),
  });
}

Deno.serve(async (req) => {
  // Telegram retries anything that is not a 200, forever. Every path below
  // therefore answers 200, including the ones that did nothing.
  const ok = () => new Response("ok");

  if (HOOK_SECRET &&
      req.headers.get("x-telegram-bot-api-secret-token") !== HOOK_SECRET) {
    return new Response("no", { status: 401 });
  }

  let update: Record<string, unknown>;
  try { update = await req.json(); } catch { return ok(); }

  const msg = (update.message ?? update.edited_message) as
    { chat?: { id: number }; text?: string; from?: { language_code?: string } } | undefined;
  if (!msg?.chat?.id || !msg.text) return ok();

  const chatId = msg.chat.id;
  const km = (msg.from?.language_code ?? "").startsWith("km");

  const start = /^\/start(?:\s+(\S+))?/.exec(msg.text.trim());
  if (!start) {
    await say(chatId, km
      ? "សូមបើកកម្មវិធី Ptas រួចចុច ភ្ជាប់ Telegram។"
      : "Open the Ptas app and tap Connect Telegram.");
    return ok();
  }

  const token = start[1];
  if (!token) {
    await say(chatId, km
      ? "សូមបើកតំណភ្ជាប់ពីកម្មវិធី Ptas ដើម្បីភ្ជាប់គណនី។"
      : "Open the link from inside the Ptas app to connect your account.");
    return ok();
  }

  const res = await rest(
    "/profiles?telegram_token=eq." + encodeURIComponent(token) + "&select=id",
    { method: "PATCH",
      headers: { prefer: "return=representation" },
      body: JSON.stringify({ telegram_chat_id: chatId }) },
  );
  const rows = res.ok ? await res.json() : [];

  await say(chatId, rows.length
    ? (km ? "ភ្ជាប់រួចរាល់។ យើងនឹងជូនដំណឹងអ្នកនៅទីនេះ។"
          : "Connected. We will send you updates here.")
    : (km ? "តំណនេះលែងប្រើបានហើយ។ សូមព្យាយាមម្តងទៀតពីកម្មវិធី។"
          : "That link has expired. Try again from the app."));
  return ok();
});
