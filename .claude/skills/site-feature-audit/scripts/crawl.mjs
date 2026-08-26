#!/usr/bin/env node
/**
 * site-feature-audit crawler
 *
 * Explores a web app as a state machine and writes structured artifacts that
 * Claude then synthesises into a feature spec.
 *
 * Design notes worth knowing before you change anything:
 *  - Every interaction starts from a FRESH page load. Slower, but it stops one
 *    click's side effects from contaminating the next observation, which is the
 *    single biggest source of garbage in naive "click everything" crawlers.
 *  - readOnly mode aborts every non-idempotent request at the network layer.
 *    That is the real guarantee; the label denylist is only a first filter.
 *  - Request/response BODIES are never stored. Only shapes (key names + value
 *    types). A spec needs the contract, not the other party's data.
 *
 * Usage:  node crawl.mjs --config ./audit.config.json
 */

import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

// ---------------------------------------------------------------- config ----

const DEFAULTS = {
  baseUrl: null,
  outputDir: './audit-output',
  maxRoutes: 40,
  maxInteractionsPerRoute: 60,
  interactionDepth: 1,
  concurrency: 1,
  politenessDelayMs: 800,
  navigationTimeoutMs: 30000,
  settleMs: 700,
  viewport: { width: 1440, height: 900 },
  readOnly: true,
  respectRobots: true,
  screenshots: true,
  fullPageScreenshots: false,
  storageStatePath: null,
  seedRoutes: [],
  includePatterns: [],
  excludePatterns: [
    '/logout', '/signout', '/sign-out', '/delete', '/billing/cancel',
    '\\.pdf$', '\\.zip$', '\\.csv$', '\\.xlsx?$',
  ],
  // Controls whose accessible name matches these are recorded but NOT clicked.
  destructiveLabelPatterns: [
    'delete', 'remove', 'destroy', 'discard', 'erase', 'wipe', 'purge',
    'send', 'submit', 'publish', 'post ', 'invite', 'share',
    'pay', 'purchase', 'buy', 'checkout', 'subscribe', 'upgrade', 'downgrade',
    'confirm', 'approve', 'reject', 'cancel subscription', 'deactivate',
    'log out', 'logout', 'sign out', 'signout',
    'report', 'block', 'flag', 'unfollow', 'follow',
  ],
  userAgentSuffix: '',
  contactNote: '',
};

const IDEMPOTENT = new Set(['GET', 'HEAD', 'OPTIONS']);

const OVERLAY_SELECTOR = [
  '[role="dialog"]', '[role="alertdialog"]', '[role="menu"]', '[role="listbox"]',
  '[role="tooltip"]', '[role="tabpanel"]', '[aria-modal="true"]',
  'dialog[open]', '.MuiModal-root', '.MuiPopover-root', '.MuiDrawer-root',
].join(',');

async function loadConfig() {
  const idx = process.argv.indexOf('--config');
  if (idx === -1) throw new Error('Missing --config <path-to-json>');
  const raw = JSON.parse(await fs.readFile(process.argv[idx + 1], 'utf8'));
  const cfg = { ...DEFAULTS, ...raw };
  if (!cfg.baseUrl) throw new Error('config.baseUrl is required');
  cfg.origin = new URL(cfg.baseUrl).origin;
  return cfg;
}

// ----------------------------------------------------------------- utils ----

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function slugify(pathname) {
  const s = pathname.replace(/^\/|\/$/g, '').replace(/[^a-zA-Z0-9]+/g, '-');
  return s || 'root';
}

/** /users/8f3a-.../orders/1042 -> /users/:id/orders/:id  */
function templatize(pathname) {
  return pathname
    .split('/')
    .map((seg) => {
      if (!seg) return seg;
      if (/^\d+$/.test(seg)) return ':id';
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(seg)) return ':uuid';
      if (/^[0-9a-f]{24,}$/i.test(seg)) return ':hash';
      if (/\d{3,}/.test(seg) && /[a-z]/i.test(seg)) return ':slug';
      return seg;
    })
    .join('/');
}

/** Recursively describe JSON structure without retaining any values. */
function shapeOf(value, depth = 0) {
  if (depth > 4) return '…';
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return value.length ? [shapeOf(value[0], depth + 1)] : [];
  }
  if (typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).slice(0, 40)) out[k] = shapeOf(value[k], depth + 1);
    return out;
  }
  return typeof value;
}

function matchesAny(str, patterns) {
  return patterns.some((p) => new RegExp(p, 'i').test(str));
}

async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------- robots ----

async function fetchRobots(cfg) {
  if (!cfg.respectRobots) return { disallow: [] };
  try {
    const res = await fetch(new URL('/robots.txt', cfg.origin));
    if (!res.ok) return { disallow: [] };
    const text = await res.text();
    const disallow = [];
    let applies = false;
    for (const line of text.split('\n')) {
      const [rawKey, ...rest] = line.split(':');
      const key = rawKey.trim().toLowerCase();
      const val = rest.join(':').trim();
      if (key === 'user-agent') applies = val === '*';
      else if (applies && key === 'disallow' && val) disallow.push(val);
    }
    return { disallow };
  } catch {
    return { disallow: [] };
  }
}

function robotsAllows(robots, pathname) {
  return !robots.disallow.some((rule) => pathname.startsWith(rule));
}

// ------------------------------------------------------- browser plumbing ----

async function makeContext(cfg) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: cfg.viewport,
    storageState: cfg.storageStatePath || undefined,
    userAgent: cfg.userAgentSuffix
      ? `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 ${cfg.userAgentSuffix}`
      : undefined,
  });

  context.setDefaultNavigationTimeout(cfg.navigationTimeoutMs);

  const blockedMutations = [];

  if (cfg.readOnly) {
    // The actual safety guarantee: nothing that could change state on the
    // target system ever leaves the browser.
    await context.route('**/*', (route) => {
      const req = route.request();
      if (!IDEMPOTENT.has(req.method())) {
        blockedMutations.push({ method: req.method(), url: templatize(new URL(req.url()).pathname) });
        return route.abort();
      }
      return route.continue();
    });

    // Belt and braces: stop native form submits and navigation prompts.
    await context.addInitScript(() => {
      document.addEventListener('submit', (e) => e.preventDefault(), true);
      window.addEventListener('beforeunload', (e) => { e.stopImmediatePropagation(); }, true);
    });
  }

  return { browser, context, blockedMutations };
}

async function newPage(context) {
  const page = await context.newPage();
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  return page;
}

// -------------------------------------------------------- page extraction ----

const EXTRACT_PAGE = () => {
  const text = (el) =>
    (el.getAttribute('aria-label') ||
      el.getAttribute('title') ||
      el.innerText ||
      el.getAttribute('placeholder') ||
      '')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 120);

  const cssPath = (el) => {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 6) {
      let sel = node.nodeName.toLowerCase();
      if (node.id) { parts.unshift(`${sel}#${CSS.escape(node.id)}`); break; }
      const tid = node.getAttribute('data-testid');
      if (tid) { parts.unshift(`${sel}[data-testid="${tid}"]`); break; }
      const sibs = node.parentNode ? [...node.parentNode.children].filter((c) => c.nodeName === node.nodeName) : [];
      if (sibs.length > 1) sel += `:nth-of-type(${sibs.indexOf(node) + 1})`;
      parts.unshift(sel);
      node = node.parentElement;
    }
    return parts.join(' > ');
  };

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };

  const controlSelector = [
    'button', '[role="button"]', '[role="tab"]', '[role="menuitem"]',
    '[role="switch"]', '[role="checkbox"]', '[role="combobox"]',
    'select', 'summary', '[aria-haspopup]', '[aria-expanded]',
    '[data-testid]', '[onclick]',
  ].join(',');

  const controls = [...document.querySelectorAll(controlSelector)]
    .filter(visible)
    .slice(0, 300)
    .map((el) => ({
      label: text(el),
      tag: el.nodeName.toLowerCase(),
      role: el.getAttribute('role') || null,
      testid: el.getAttribute('data-testid') || null,
      hasPopup: el.getAttribute('aria-haspopup') || null,
      expanded: el.getAttribute('aria-expanded') || null,
      disabled: el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true',
      selector: cssPath(el),
    }))
    .filter((c) => c.label || c.testid);

  const forms = [...document.querySelectorAll('form')].map((f) => ({
    name: f.getAttribute('name') || f.getAttribute('id') || null,
    action: f.getAttribute('action') || null,
    method: (f.getAttribute('method') || 'get').toUpperCase(),
    fields: [...f.querySelectorAll('input,select,textarea')].map((i) => ({
      name: i.getAttribute('name') || i.getAttribute('id') || null,
      type: i.getAttribute('type') || i.nodeName.toLowerCase(),
      label: text(i),
      required: i.hasAttribute('required') || i.getAttribute('aria-required') === 'true',
      pattern: i.getAttribute('pattern') || null,
      minLength: i.getAttribute('minlength') || null,
      maxLength: i.getAttribute('maxlength') || null,
      options: i.nodeName === 'SELECT' ? [...i.options].map((o) => o.label).slice(0, 30) : undefined,
    })),
  }));

  const headings = [...document.querySelectorAll('h1,h2,h3')].map((h) => ({
    level: Number(h.nodeName[1]),
    text: text(h),
  })).slice(0, 60);

  const landmarks = [...document.querySelectorAll('header,nav,main,aside,footer,[role="navigation"],[role="main"],[role="banner"]')]
    .filter(visible)
    .map((el) => ({ tag: el.nodeName.toLowerCase(), role: el.getAttribute('role') || null, label: text(el).slice(0, 60) }));

  const links = [...document.querySelectorAll('a[href]')]
    .map((a) => a.getAttribute('href'))
    .filter(Boolean);

  const tables = [...document.querySelectorAll('table')].map((t) => ({
    columns: [...t.querySelectorAll('thead th, tr:first-child th')].map((th) => text(th)).slice(0, 25),
    rowCount: t.querySelectorAll('tbody tr').length,
  }));

  const stack = {
    nextjs: !!document.querySelector('#__next, #__NEXT_DATA__') || !!window.__NEXT_DATA__,
    react: !!document.querySelector('[data-reactroot]') || !!window.React,
    mui: !!document.querySelector('[class*="Mui"]'),
    generator: document.querySelector('meta[name="generator"]')?.content || null,
  };

  return {
    title: document.title,
    description: document.querySelector('meta[name="description"]')?.content || null,
    headings, landmarks, controls, forms, tables, links, stack,
    emptyStateHints: [...document.querySelectorAll('[class*="empty"],[class*="Empty"]')].filter(visible).map(text).slice(0, 10),
  };
};

const SNAPSHOT_OVERLAYS = (sel) =>
  [...document.querySelectorAll(sel)]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    })
    .map((el) => el.outerHTML.length + '|' + el.className + '|' + (el.getAttribute('role') || ''));

const DESCRIBE_NEW_OVERLAYS = ({ sel, before }) => {
  const text = (el) => (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 400);
  const beforeSet = new Set(before);
  return [...document.querySelectorAll(sel)]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const sig = el.outerHTML.length + '|' + el.className + '|' + (el.getAttribute('role') || '');
      return !beforeSet.has(sig);
    })
    .map((el) => ({
      role: el.getAttribute('role') || el.nodeName.toLowerCase(),
      ariaLabel: el.getAttribute('aria-label') || null,
      heading: el.querySelector('h1,h2,h3,[role="heading"]')?.innerText?.trim()?.slice(0, 120) || null,
      textPreview: text(el),
      fields: [...el.querySelectorAll('input,select,textarea')].map((i) => ({
        name: i.getAttribute('name') || i.getAttribute('id') || null,
        type: i.getAttribute('type') || i.nodeName.toLowerCase(),
        required: i.hasAttribute('required'),
      })),
      actions: [...el.querySelectorAll('button,[role="button"],[role="menuitem"],[role="option"]')]
        .map((b) => (b.getAttribute('aria-label') || b.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 60))
        .filter(Boolean)
        .slice(0, 30),
    }))
    .slice(0, 5);
};

/**
 * Tag currently-visible overlays so a follow-up pass can scope selectors into
 * them. Returns the count; the newest overlay is the highest index.
 */
const TAG_OVERLAYS = (sel) => {
  const els = [...document.querySelectorAll(sel)].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  els.forEach((el, i) => el.setAttribute('data-audit-overlay', String(i)));
  return els.length;
};

/**
 * Enumerate controls within a scope (an overlay, or the whole document) plus a
 * content signature. The signature is what lets us tell "this tab swapped the
 * panel content" from "nothing happened" — without it, in-place view changes are
 * indistinguishable from dead buttons.
 */
const EXTRACT_CONTROLS = ({ root }) => {
  const scope = root ? document.querySelector(root) : document;
  if (!scope) return { controls: [], headings: [], signature: '', missing: true };

  const text = (el) =>
    (el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText ||
      el.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 120);

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };

  const cssPath = (el) => {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 7) {
      let sel = node.nodeName.toLowerCase();
      if (node.id) { parts.unshift(`${sel}#${CSS.escape(node.id)}`); break; }
      const tid = node.getAttribute('data-testid');
      if (tid) { parts.unshift(`${sel}[data-testid="${tid}"]`); break; }
      const ov = node.getAttribute('data-audit-overlay');
      if (ov !== null) { parts.unshift(`[data-audit-overlay="${ov}"]`); break; }
      const sibs = node.parentNode ? [...node.parentNode.children].filter((c) => c.nodeName === node.nodeName) : [];
      if (sibs.length > 1) sel += `:nth-of-type(${sibs.indexOf(node) + 1})`;
      parts.unshift(sel);
      node = node.parentElement;
    }
    return parts.join(' > ');
  };

  const controlSelector = [
    'button', '[role="button"]', '[role="tab"]', '[role="menuitem"]', '[role="option"]',
    '[role="switch"]', '[role="checkbox"]', '[role="combobox"]', '[role="treeitem"]',
    'select', 'summary', '[aria-haspopup]', '[aria-expanded]', '[data-testid]', '[onclick]',
  ].join(',');

  const controls = [...scope.querySelectorAll(controlSelector)]
    .filter(visible)
    .slice(0, 200)
    .map((el) => ({
      label: text(el),
      tag: el.nodeName.toLowerCase(),
      role: el.getAttribute('role') || null,
      testid: el.getAttribute('data-testid') || null,
      hasPopup: el.getAttribute('aria-haspopup') || null,
      expanded: el.getAttribute('aria-expanded') || null,
      disabled: el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true',
      selector: cssPath(el),
    }))
    .filter((c) => c.label || c.testid);

  const headings = [...scope.querySelectorAll('h1,h2,h3,[role="heading"]')]
    .filter(visible).map((h) => text(h)).slice(0, 40);

  // Signature deliberately excludes volatile things (timestamps, counts) by
  // sampling structure rather than full text.
  const main = scope.querySelector('main') || scope.body || scope;
  const signature = [
    headings.join('|'),
    controls.map((c) => c.label).sort().join('|'),
    String(Math.round((main.innerText || '').length / 50)),
  ].join('#');

  return { controls, headings, signature };
};

// ------------------------------------------------------------ network tap ----

function attachNetworkTap(page, sink) {
  page.on('response', async (res) => {
    try {
      const req = res.request();
      const type = req.resourceType();
      if (type !== 'xhr' && type !== 'fetch') return;
      const url = new URL(req.url());
      const entry = {
        method: req.method(),
        path: templatize(url.pathname),
        origin: url.origin,
        query: [...url.searchParams.keys()],
        status: res.status(),
        contentType: (res.headers()['content-type'] || '').split(';')[0],
        requestShape: null,
        responseShape: null,
      };
      const post = req.postData();
      if (post) {
        try { entry.requestShape = shapeOf(JSON.parse(post)); } catch { entry.requestShape = 'non-json'; }
      }
      if (entry.contentType.includes('json')) {
        try { entry.responseShape = shapeOf(await res.json()); } catch { /* streamed or gone */ }
      }
      sink.push(entry);
    } catch { /* response bodies vanish on navigation; not worth failing the run */ }
  });
}

// -------------------------------------------------------- route discovery ----

async function discoverRoutes(cfg, context, robots) {
  const found = new Map();
  const queue = [cfg.baseUrl, ...cfg.seedRoutes.map((r) => new URL(r, cfg.origin).href)];
  const seen = new Set();

  // sitemap.xml is free route discovery when it exists
  try {
    const res = await fetch(new URL('/sitemap.xml', cfg.origin));
    if (res.ok) {
      const xml = await res.text();
      for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
        if (m[1].startsWith(cfg.origin)) queue.push(m[1]);
      }
    }
  } catch { /* no sitemap, fine */ }

  const page = await newPage(context);

  while (queue.length && found.size < cfg.maxRoutes) {
    const href = queue.shift();
    let url;
    try { url = new URL(href); } catch { continue; }
    if (url.origin !== cfg.origin) continue;

    const key = templatize(url.pathname);
    if (seen.has(key)) continue;
    seen.add(key);

    if (!robotsAllows(robots, url.pathname)) continue;
    if (matchesAny(url.pathname, cfg.excludePatterns)) continue;
    if (cfg.includePatterns.length && !matchesAny(url.pathname, cfg.includePatterns)) continue;

    try {
      const resp = await page.goto(url.href, { waitUntil: 'domcontentloaded' });
      await sleep(cfg.settleMs);
      const status = resp?.status() ?? 0;
      if (status >= 400) continue;
      if (status === 403 || status === 429) {
        console.warn(`  ! ${status} on ${url.pathname} — target is refusing automation. Stopping discovery.`);
        break;
      }
      found.set(key, { key, url: url.href, pathname: url.pathname, status });
      const links = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => a.href));
      for (const l of links) queue.push(l);
      await sleep(cfg.politenessDelayMs);
    } catch (e) {
      console.warn(`  ! could not load ${url.pathname}: ${e.message.split('\n')[0]}`);
    }
  }

  await page.close();
  return [...found.values()];
}

// ------------------------------------------------------ interaction sweep ----

function classify(control, cfg) {
  if (control.disabled) return { click: false, reason: 'disabled' };
  const label = (control.label || control.testid || '').toLowerCase();
  if (matchesAny(label, cfg.destructiveLabelPatterns)) {
    return { click: false, reason: 'side-effecting label — recorded, not clicked' };
  }
  return { click: true, reason: null };
}

/**
 * Walk one route as a state machine.
 *
 * The queue holds {control, path, depth, scope}. `path` is the click sequence
 * needed to reach the state the control lives in; every item replays that path
 * from a fresh page load before acting. Replay is expensive, but the alternative
 * — chaining clicks in one long-lived page — means each observation is polluted
 * by the last, which is exactly how naive crawlers produce unusable output.
 */
async function sweepRoute(cfg, context, route, outDir) {
  const network = [];
  const result = { ...route, page: null, interactions: [], errors: [], discovered: [] };

  const page = await newPage(context);
  attachNetworkTap(page, network);
  page.on('pageerror', (e) => result.errors.push({ type: 'pageerror', message: String(e).slice(0, 300) }));
  page.on('console', (m) => {
    if (m.type() === 'error') result.errors.push({ type: 'console', message: m.text().slice(0, 300) });
  });

  await page.goto(route.url, { waitUntil: 'domcontentloaded' });
  await sleep(cfg.settleMs);
  result.page = await page.evaluate(EXTRACT_PAGE);
  const baseState = await page.evaluate(EXTRACT_CONTROLS, { root: null });
  const baseLabels = new Set(baseState.controls.map((c) => c.selector));

  const shotDir = path.join(outDir, 'screenshots');
  if (cfg.screenshots) {
    await fs.mkdir(shotDir, { recursive: true });
    await page.screenshot({ path: path.join(shotDir, 'route.png'), fullPage: cfg.fullPageScreenshots });
  }
  await page.close();

  const queue = baseState.controls.map((control) => ({ control, path: [], depth: 0, scope: null }));
  const seenStates = new Set([baseState.signature]);
  let budget = cfg.maxInteractionsPerRoute;
  let i = 0;

  while (queue.length && budget > 0) {
    const item = queue.shift();
    budget -= 1;
    i += 1;

    const verdict = classify(item.control, cfg);
    if (!verdict.click) {
      result.interactions.push({
        control: item.control, path: item.path, depth: item.depth,
        clicked: false, reason: verdict.reason,
      });
      continue;
    }

    const p = await newPage(context);
    const iNet = [];
    attachNetworkTap(p, iNet);
    const record = {
      control: item.control, path: item.path, depth: item.depth,
      clicked: true, opened: [], revealed: null, navigatedTo: null,
      apiCalls: [], error: null,
    };

    try {
      await p.goto(route.url, { waitUntil: 'domcontentloaded' });
      await sleep(cfg.settleMs);

      // Replay the path to the state this control lives in.
      for (const step of item.path) {
        await p.evaluate(TAG_OVERLAYS, OVERLAY_SELECTOR);
        await p.locator(step).first().click({ timeout: 5000 });
        await sleep(cfg.settleMs);
      }
      await p.evaluate(TAG_OVERLAYS, OVERLAY_SELECTOR);

      const netMark = iNet.length;
      const before = await p.evaluate(SNAPSHOT_OVERLAYS, OVERLAY_SELECTOR);
      const sigBefore = (await p.evaluate(EXTRACT_CONTROLS, { root: item.scope })).signature;
      const urlBefore = p.url();

      await p.locator(item.control.selector).first().click({ timeout: 5000 });
      await sleep(cfg.settleMs);

      const urlNow = p.url();
      if (urlNow !== urlBefore) {
        record.navigatedTo = templatize(new URL(urlNow).pathname);
        record.navigatedToUrl = urlNow;
        if (new URL(urlNow).origin === cfg.origin) result.discovered.push(urlNow);
      }

      record.opened = await p.evaluate(DESCRIBE_NEW_OVERLAYS, { sel: OVERLAY_SELECTOR, before });
      record.apiCalls = dedupeNetwork(iNet.slice(netMark)).map((e) => `${e.method} ${e.path}`);

      let childScope = null;
      let childControls = [];

      if (record.opened?.length) {
        // Scope into the newest overlay so we can explore its interior.
        const count = await p.evaluate(TAG_OVERLAYS, OVERLAY_SELECTOR);
        childScope = `[data-audit-overlay="${count - 1}"]`;
        const inner = await p.evaluate(EXTRACT_CONTROLS, { root: childScope });
        childControls = inner.controls;
        record.overlayControls = inner.controls.map((c) => c.label).filter(Boolean);
      } else if (!record.navigatedTo) {
        // No overlay, no navigation — did the content change in place? This is
        // what catches tab panels, accordions and filter results, which would
        // otherwise be recorded as dead buttons.
        const after = await p.evaluate(EXTRACT_CONTROLS, { root: item.scope });
        if (after.signature !== sigBefore && !seenStates.has(after.signature)) {
          seenStates.add(after.signature);
          const fresh = after.controls.filter((c) => !baseLabels.has(c.selector));
          record.revealed = {
            headings: after.headings,
            newControls: fresh.map((c) => c.label).filter(Boolean).slice(0, 40),
            newControlCount: fresh.length,
          };
          childControls = fresh;
        }
      }

      // Queue the interior for the next depth level.
      if (item.depth + 1 < cfg.interactionDepth && childControls.length) {
        for (const c of childControls.slice(0, 25)) {
          queue.push({
            control: c,
            path: [...item.path, item.control.selector],
            depth: item.depth + 1,
            scope: childScope,
          });
        }
      }

      if (cfg.screenshots && (record.opened?.length || record.revealed || record.navigatedTo)) {
        await p.screenshot({ path: path.join(shotDir, `interaction-${i}.png`) });
        record.screenshot = `screenshots/interaction-${i}.png`;
      }
    } catch (e) {
      record.error = e.message.split('\n')[0].slice(0, 200);
    }

    result.interactions.push(record);
    network.push(...iNet);
    await p.close();
    await sleep(cfg.politenessDelayMs);
  }

  result.budgetExhausted = queue.length > 0;
  result.queueRemaining = queue.length;
  result.network = dedupeNetwork(network);
  return result;
}

function dedupeNetwork(entries) {
  const map = new Map();
  for (const e of entries) {
    const k = `${e.method} ${e.origin}${e.path}`;
    if (!map.has(k)) map.set(k, { ...e, seen: 1, statuses: [e.status] });
    else {
      const cur = map.get(k);
      cur.seen += 1;
      if (!cur.statuses.includes(e.status)) cur.statuses.push(e.status);
      cur.requestShape ||= e.requestShape;
      cur.responseShape ||= e.responseShape;
    }
  }
  return [...map.values()].map(({ status, ...rest }) => rest);
}

// ------------------------------------------------------------------- main ----

async function main() {
  const cfg = await loadConfig();
  const out = path.resolve(cfg.outputDir);
  await fs.mkdir(out, { recursive: true });

  console.log(`\n▸ Auditing ${cfg.baseUrl}`);
  console.log(`  read-only: ${cfg.readOnly}  |  respect robots: ${cfg.respectRobots}\n`);

  const robots = await fetchRobots(cfg);
  if (robots.disallow.length) console.log(`  robots.txt: ${robots.disallow.length} disallow rules honoured`);

  const { browser, context, blockedMutations } = await makeContext(cfg);

  console.log('▸ Phase 1 — route discovery');
  const routes = await discoverRoutes(cfg, context, robots);
  console.log(`  found ${routes.length} routes\n`);

  console.log('▸ Phase 2 — interaction sweep');
  const summaries = [];
  const allNetwork = [];

  // Routes discovered by clicking (router.push, not <a href>) get fed back into
  // the frontier. Without this, any screen reachable only via a button is
  // recorded as an edge and then never actually swept — which on an SPA is
  // typically most of the application.
  const frontier = [...routes];
  const knownKeys = new Set(routes.map((r) => templatize(r.pathname)));
  let processed = 0;

  while (frontier.length && processed < cfg.maxRoutes) {
    const route = frontier.shift();
    processed += 1;
    const slug = slugify(route.pathname);
    const routeDir = path.join(out, 'routes', slug);
    await fs.mkdir(routeDir, { recursive: true });
    process.stdout.write(`  ${route.pathname} … `);

    let res;
    try {
      res = await sweepRoute(cfg, context, route, routeDir);
    } catch (e) {
      console.log(`failed (${e.message.split('\n')[0]})`);
      summaries.push({ ...route, slug, failed: e.message.slice(0, 200) });
      continue;
    }

    const clicked = res.interactions.filter((x) => x.clicked).length;
    const overlays = res.interactions.filter((x) => x.opened?.length).length;
    const views = res.interactions.filter((x) => x.revealed).length;
    const nested = res.interactions.filter((x) => x.depth > 0).length;

    let added = 0;
    for (const href of res.discovered) {
      const u = new URL(href);
      const key = templatize(u.pathname);
      if (knownKeys.has(key)) continue;
      if (!robotsAllows(robots, u.pathname)) continue;
      if (matchesAny(u.pathname, cfg.excludePatterns)) continue;
      if (cfg.includePatterns.length && !matchesAny(u.pathname, cfg.includePatterns)) continue;
      knownKeys.add(key);
      frontier.push({ key, url: u.href, pathname: u.pathname, status: 200, viaInteraction: true });
      added += 1;
    }

    console.log(
      `${res.page.controls.length} controls, ${clicked} clicked, ${overlays} overlays, ` +
      `${views} in-place views, ${nested} nested` +
      (added ? `, +${added} new routes` : '') +
      (res.budgetExhausted ? ` [budget hit, ${res.queueRemaining} queued]` : ''),
    );

    await writeJson(path.join(routeDir, 'route.json'), { ...res, interactions: undefined, network: undefined, discovered: undefined });
    await writeJson(path.join(routeDir, 'interactions.json'), res.interactions);
    await writeJson(path.join(routeDir, 'network.json'), res.network);
    allNetwork.push(...res.network);

    summaries.push({
      slug, pathname: route.pathname, title: res.page.title,
      viaInteraction: !!route.viaInteraction,
      controlCount: res.page.controls.length, clicked, overlays, views, nested,
      formCount: res.page.forms.length, errorCount: res.errors.length,
      budgetExhausted: res.budgetExhausted, queueRemaining: res.queueRemaining,
    });
  }

  if (frontier.length) {
    console.log(`\n  ! ${frontier.length} discovered routes left unswept (maxRoutes reached)`);
  }

  await writeJson(path.join(out, 'api-surface.json'), dedupeNetwork(allNetwork));
  await writeJson(path.join(out, 'blocked-mutations.json'), {
    note: 'Non-idempotent requests aborted by read-only mode. Each one marks a feature whose write path exists but was deliberately not exercised.',
    entries: blockedMutations,
  });
  await writeJson(path.join(out, 'manifest.json'), {
    baseUrl: cfg.baseUrl,
    startedAt: new Date().toISOString(),
    config: { ...cfg, origin: undefined },
    robotsDisallow: robots.disallow,
    routes: summaries,
    unsweptDiscovered: frontier.map((f) => f.pathname),
    stats: {
      routes: summaries.length,
      controls: summaries.reduce((a, s) => a + (s.controlCount || 0), 0),
      overlays: summaries.reduce((a, s) => a + (s.overlays || 0), 0),
      inPlaceViews: summaries.reduce((a, s) => a + (s.views || 0), 0),
      nestedInteractions: summaries.reduce((a, s) => a + (s.nested || 0), 0),
      routesFoundByClicking: summaries.filter((s) => s.viaInteraction).length,
      apiEndpoints: dedupeNetwork(allNetwork).length,
    },
  });

  await browser.close();
  console.log(`\n▸ Done. Artifacts in ${out}`);
  console.log('  Next: point Claude at manifest.json and ask it to synthesise the spec.\n');
}

main().catch((e) => {
  console.error('\n✗ Crawl failed:', e.message);
  process.exit(1);
});
