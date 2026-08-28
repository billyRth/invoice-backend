import { chromium } from 'playwright';
const F = 'file:///home/user/invoice-backend/rental-app/ptas.html';
const findings = [];
const note = (area, msg) => findings.push(`${area}: ${msg}`);

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

async function signIn(p, role) {
  await p.fill('#gate-phone','012345678'); await p.click('#gate-continue');
  await p.waitForTimeout(150); await p.click(`.rolecard[data-role="${role}"]`);
  await p.waitForTimeout(300);
}

const CONTRAST = `(() => {
  const lum = (c) => { const [r,g,b] = c; const f = v => { v/=255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055,2.4); };
    return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b); };
  const parse = (s) => { const m = s.match(/rgba?\\(([^)]+)\\)/); if (!m) return null;
    const p = m[1].split(',').map(x=>parseFloat(x)); return { rgb:[p[0],p[1],p[2]], a: p.length>3 ? p[3] : 1 }; };
  const bgOf = (el) => { let n = el; while (n && n !== document.documentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0.5) return c.rgb; n = n.parentElement; }
    const body = parse(getComputedStyle(document.body).backgroundColor); return body ? body.rgb : [255,255,255]; };
  const ratio = (a,b) => { const l1 = lum(a), l2 = lum(b); const hi = Math.max(l1,l2), lo = Math.min(l1,l2);
    return (hi + 0.05) / (lo + 0.05); };
  const out = [];
  document.querySelectorAll('*').forEach(el => {
    if (el.offsetParent === null) return;
    const txt = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim()).map(n=>n.textContent.trim()).join('');
    if (!txt) return;
    const cs = getComputedStyle(el);
    const fg = parse(cs.color); if (!fg) return;
    const size = parseFloat(cs.fontSize), weight = parseInt(cs.fontWeight) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    const r = ratio(fg.rgb, bgOf(el));
    if (r < need) out.push({ text: txt.slice(0,28), size: Math.round(size), got: +r.toFixed(2), need });
  });
  return out;
})()`;

// ---------- contrast across every theme and screen
for (const theme of ['auto','light','dark','khmer']) {
  const ctx = await b.newContext({ viewport:{width:390,height:844}, colorScheme: theme === 'dark' ? 'dark' : 'light' });
  const p = await ctx.newPage();
  await p.goto(F, { waitUntil:'domcontentloaded' });
  await signIn(p, 'renter');
  await p.waitForFunction(() => document.querySelectorAll('#feed .card').length > 0, null, {timeout:8000});
  await p.click('[data-tab="s-me"]');
  if (theme !== 'auto') await p.click(`#theme-switch [data-theme-set="${theme}"]`);
  await p.waitForTimeout(250);

  for (const tab of ['s-explore','s-saved','s-renting','s-me']) {
    await p.click(`[data-tab="${tab}"]`);
    await p.waitForTimeout(250);
    const bad = await p.evaluate(CONTRAST);
    bad.forEach(x => note(`contrast/${theme}/${tab}`, `"${x.text}" ${x.size}px ${x.got}:1 needs ${x.need}`));
  }
  // detail too
  await p.click('[data-tab="s-explore"]');
  await p.locator('#feed [data-card]').first().click();
  await p.waitForTimeout(500);
  const badD = await p.evaluate(CONTRAST);
  badD.forEach(x => note(`contrast/${theme}/detail`, `"${x.text}" ${x.size}px ${x.got}:1 needs ${x.need}`));
  await ctx.close();
}

// ---------- small screen overflow + accessible names + alts
const ctx = await b.newContext({ viewport:{width:360,height:640} });
const p = await ctx.newPage();
await p.goto(F, { waitUntil:'domcontentloaded' });
await signIn(p, 'renter');
await p.waitForFunction(() => document.querySelectorAll('#feed .card').length > 0, null, {timeout:8000});

for (const tab of ['s-explore','s-saved','s-renting','s-me']) {
  await p.click(`[data-tab="${tab}"]`);
  await p.waitForTimeout(250);
  const over = await p.evaluate((t) => {
    const sc = document.querySelector(`#${t} .scroll`);
    const wide = [];
    sc.querySelectorAll('*').forEach(el => {
      if (el.offsetParent === null) return;
      const r = el.getBoundingClientRect();
      const par = sc.getBoundingClientRect();
      if (r.right > par.right + 1 && !el.closest('.chips,.gallery,.recent-strip,.gallery-strip'))
        wide.push((el.className || el.tagName) + ' +' + Math.round(r.right - par.right) + 'px');
    });
    return wide.slice(0, 6);
  }, tab);
  over.forEach(x => note(`overflow360/${tab}`, x));

  const unnamed = await p.evaluate(() => {
    const out = [];
    document.querySelectorAll('button, a, input, select').forEach(el => {
      if (el.offsetParent === null) return;
      const name = (el.getAttribute('aria-label') || el.textContent || '').trim()
                || (el.labels && el.labels.length ? el.labels[0].textContent.trim() : '');
      if (!name) out.push(el.tagName.toLowerCase() + '.' + (el.className || el.id || '?'));
    });
    return out.slice(0, 6);
  });
  unnamed.forEach(x => note(`unnamed/${tab}`, x));
}

const noAlt = await p.evaluate(() =>
  [...document.querySelectorAll('img')].filter(i => !i.hasAttribute('alt')).length);
if (noAlt) note('images', `${noAlt} img without an alt attribute`);

// ---------- keyboard: focus must stay visible and reachable
await p.click('[data-tab="s-explore"]');
await p.waitForTimeout(200);
const kb = await p.evaluate(async () => {
  const seen = [];
  for (let i = 0; i < 25; i++) {
    const el = document.activeElement;
    if (el && el !== document.body) {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      seen.push({ tag: el.tagName, off: cs.outlineStyle === 'none' && !cs.boxShadow.includes('inset'), zero: r.width === 0 || r.height === 0 });
    }
    await new Promise(r => setTimeout(r, 5));
    break;
  }
  return seen;
});
await ctx.close();
await b.close();

console.log(findings.length ? 'FINDINGS ' + findings.length : 'FINDINGS 0');
findings.forEach(f => console.log('  - ' + f));
