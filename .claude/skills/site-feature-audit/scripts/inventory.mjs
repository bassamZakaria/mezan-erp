#!/usr/bin/env node
/**
 * site-feature-audit — inventory generator
 *
 * Reads the crawl artifacts and emits the mechanical half of the BA deliverable:
 * a screen register, a sub-screen register, an action catalogue, and a
 * navigation graph — all with stable IDs.
 *
 * Doing this in code rather than by hand matters for two reasons: IDs stay
 * stable across re-runs (so a task list stays traceable when the target
 * changes), and the model never invents a screen that wasn't observed.
 *
 * What it deliberately does NOT do: workflows, business rules, priorities,
 * intent. Those require judgement and are written during synthesis.
 *
 * Usage:  node inventory.mjs --input ../audit-output [--output ../audit-output/inventory]
 */

import fs from 'node:fs/promises';
import path from 'node:path';

// ------------------------------------------------------------------ args ----

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : process.argv[i + 1];
}

const INPUT = path.resolve(arg('--input', './audit-output'));
const OUTPUT = path.resolve(arg('--output', path.join(INPUT, 'inventory')));

const pad = (n, w = 3) => String(n).padStart(w, '0');
const clean = (s) => (s || '').replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();

async function readJson(p, fallback = null) {
  try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return fallback; }
}

// ------------------------------------------------------- sub-screen keying ----

/**
 * Twenty row-level "Edit" buttons open one dialog, not twenty. Key overlays by
 * what they ARE (role + heading + field/action signature) rather than by which
 * control opened them, or the register fills with duplicates.
 */
function overlayKey(o) {
  const heading = clean(o.heading || o.ariaLabel || '');
  const fieldSig = (o.fields || []).map((f) => f.name || f.type).sort().join(',');
  const actionSig = (o.actions || []).slice(0, 6).map((a) => clean(a).toLowerCase()).sort().join(',');
  return `${o.role}|${heading.toLowerCase()}|${fieldSig}|${actionSig}`;
}

function overlayKind(o) {
  const r = (o.role || '').toLowerCase();
  if (r.includes('dialog')) return 'Modal';
  if (r === 'menu') return 'Menu';
  if (r === 'listbox' || r === 'combobox') return 'Dropdown';
  if (r === 'tooltip') return 'Tooltip';
  if (r === 'tabpanel') return 'Tab panel';
  if (/drawer/i.test(o.ariaLabel || '')) return 'Drawer';
  return 'Overlay';
}

function controlKind(c) {
  const role = (c.role || '').toLowerCase();
  if (role === 'tab') return 'Tab';
  if (role === 'menuitem') return 'Menu item';
  if (role === 'switch' || role === 'checkbox') return 'Toggle';
  if (c.tag === 'select' || role === 'combobox') return 'Select';
  if (c.hasPopup) return 'Menu trigger';
  return 'Button';
}

// -------------------------------------------------------------- build set ----

async function build() {
  const manifest = await readJson(path.join(INPUT, 'manifest.json'));
  if (!manifest) throw new Error(`No manifest.json in ${INPUT}. Run crawl.mjs first.`);

  const screens = [];
  const subScreens = [];
  const actions = [];
  const edges = [];
  const gaps = [];

  const pathToScreen = new Map();
  let screenNo = 0;
  let actionNo = 0;

  // Pass 1 — register every route as a screen, so navigation targets resolve.
  for (const r of manifest.routes) {
    if (r.failed) { gaps.push({ type: 'route-failed', ref: r.pathname, detail: r.failed }); continue; }
    screenNo += 1;
    const id = `SCR-${pad(screenNo)}`;
    const screen = {
      id, slug: r.slug, path: r.pathname, name: clean(r.title) || r.pathname,
      controlCount: r.controlCount || 0, formCount: r.formCount || 0,
      subScreens: [], purpose: null,
    };
    screens.push(screen);
    pathToScreen.set(r.pathname, id);
    // Also index the templatised form so navigatedTo can match.
    pathToScreen.set(r.pathname.replace(/\/\d+/g, '/:id'), id);
  }

  // Pass 2 — actions and sub-screens.
  for (const screen of screens) {
    const dir = path.join(INPUT, 'routes', screen.slug);
    const route = await readJson(path.join(dir, 'route.json'));
    const interactions = await readJson(path.join(dir, 'interactions.json'), []);

    if (route?.page) {
      screen.headings = (route.page.headings || []).filter((h) => h.level <= 2).map((h) => clean(h.text)).slice(0, 8);
      screen.hasTable = (route.page.tables || []).length > 0;
      screen.tableColumns = route.page.tables?.[0]?.columns?.map(clean) || [];
      screen.forms = (route.page.forms || []).map((f) => ({
        name: f.name,
        fields: (f.fields || []).map((x) => ({
          name: x.name, type: x.type, label: clean(x.label), required: !!x.required,
          pattern: x.pattern, maxLength: x.maxLength, options: x.options?.map(clean),
        })),
      }));
      screen.emptyStateHints = (route.page.emptyStateHints || []).map(clean);
    }

    const subIndex = new Map();
    const dedupe = new Map(); // collapse repeated row-level controls

    for (const it of interactions) {
      const c = it.control || {};
      const label = clean(c.label || c.testid || '(unlabelled)');
      const kind = controlKind(c);

      // Resolve what the interaction produced.
      let effect = 'No observable change';
      let targets = [];

      if (it.clicked === false) {
        effect = c.disabled ? 'Disabled' : 'Not exercised (write path)';
        if (!c.disabled) {
          gaps.push({ type: 'unexercised-action', ref: `${screen.id} · ${label}`, detail: it.reason });
        }
      } else if (it.error) {
        effect = 'Interaction failed';
        gaps.push({ type: 'interaction-error', ref: `${screen.id} · ${label}`, detail: it.error });
      } else if (it.revealed) {
        // A tab panel or accordion: no overlay, no navigation, but the content
        // changed. These are sub-screens too, and the commonest thing a
        // click-everything crawler silently drops.
        const key = `inplace|${clean(it.revealed.headings?.join('|') || label).toLowerCase()}`;
        if (!subIndex.has(key)) {
          const subId = `${screen.id}.${subIndex.size + 1}`;
          const sub = {
            id: subId, parent: screen.id, kind: 'In-place view',
            name: clean(it.revealed.headings?.[0] || `View: ${label}`),
            fields: [], actions: (it.revealed.newControls || []).slice(0, 12),
            openedBy: [],
          };
          subIndex.set(key, sub);
          subScreens.push(sub);
          screen.subScreens.push(subId);
        }
        targets = [subIndex.get(key).id];
        effect = `Reveals ${targets[0]}`;
      } else {
        if (it.opened?.length) {
          for (const o of it.opened) {
            const key = overlayKey(o);
            if (!subIndex.has(key)) {
              const subId = `${screen.id}.${subIndex.size + 1}`;
              const sub = {
                id: subId, parent: screen.id, kind: overlayKind(o),
                name: clean(o.heading || o.ariaLabel || `${overlayKind(o)} from "${label}"`),
                fields: (o.fields || []).map((f) => ({ name: f.name, type: f.type, required: !!f.required })),
                actions: (o.actions || []).map(clean).filter(Boolean),
                openedBy: [],
              };
              subIndex.set(key, sub);
              subScreens.push(sub);
              screen.subScreens.push(subId);
            }
            const sub = subIndex.get(key);
            targets.push(sub.id);
          }
          effect = `Opens ${targets.join(', ')}`;
        } else if (it.navigatedTo) {
          const target = pathToScreen.get(it.navigatedTo) || null;
          targets = [target || it.navigatedTo];
          effect = `Navigates to ${target || it.navigatedTo}`;
          edges.push({ from: screen.id, to: target || it.navigatedTo, via: label, unresolved: !target });
          if (!target) gaps.push({ type: 'unmapped-destination', ref: `${screen.id} · ${label}`, detail: it.navigatedTo });
        } else if (it.apiCalls?.length) {
          effect = 'Background request';
        }
      }

      const dk = `${label}|${kind}|${effect}|${it.depth || 0}`;
      if (dedupe.has(dk)) {
        const prev = dedupe.get(dk);
        prev.instances += 1;
        for (const t of targets) {
          const sub = subScreens.find((s) => s.id === t);
          if (sub && !sub.openedBy.includes(prev.id)) sub.openedBy.push(prev.id);
        }
        continue;
      }

      actionNo += 1;
      const action = {
        id: `ACT-${pad(actionNo, 4)}`,
        screen: screen.id, label, kind, effect, targets,
        depth: it.depth || 0,
        reachedVia: (it.path || []).length ? `${(it.path || []).length} step(s) from route` : 'direct',
        apiCalls: it.apiCalls || [],
        instances: 1,
        verified: it.clicked === true && !it.error,
        selector: c.selector,
      };
      dedupe.set(dk, action);
      actions.push(action);

      for (const t of targets) {
        const sub = subScreens.find((s) => s.id === t);
        if (sub && !sub.openedBy.includes(action.id)) sub.openedBy.push(action.id);
      }
    }
  }

  return { manifest, screens, subScreens, actions, edges, gaps };
}

// ------------------------------------------------------------- rendering ----

function renderScreens({ screens, subScreens }) {
  const lines = ['# Screen register', '',
    'Every screen and sub-screen observed during the audit. IDs are stable across',
    're-runs — reference them from the task list rather than by name.', '',
    '| ID | Screen | Route | Sub-screens | Controls | Forms |',
    '|---|---|---|---|---|---|'];
  for (const s of screens) {
    lines.push(`| ${s.id} | ${s.name} | \`${s.path}\` | ${s.subScreens.length} | ${s.controlCount} | ${s.formCount} |`);
  }
  lines.push('', '## Sub-screens', '',
    'Modals, drawers, menus and dropdowns, deduplicated by identity — a dialog',
    'reachable from twenty table rows is listed once.', '',
    '| ID | Type | Name | Parent | Opened by | Fields | Actions |',
    '|---|---|---|---|---|---|---|');
  for (const s of subScreens) {
    lines.push(`| ${s.id} | ${s.kind} | ${s.name} | ${s.parent} | ${s.openedBy.join(', ') || '—'} | ${s.fields.length} | ${s.actions.slice(0, 5).join(', ') || '—'} |`);
  }
  lines.push('', '## Screen detail', '');
  for (const s of screens) {
    lines.push(`### ${s.id} — ${s.name}`, '', `**Route:** \`${s.path}\``, '');
    if (s.headings?.length) lines.push(`**Sections:** ${s.headings.join(' · ')}`, '');
    if (s.hasTable) lines.push(`**Table columns:** ${s.tableColumns.join(', ') || 'unlabelled'}`, '');
    if (s.emptyStateHints?.length) lines.push(`**Empty-state text detected:** ${s.emptyStateHints.length} region(s)`, '');
    for (const f of s.forms || []) {
      lines.push(`**Form${f.name ? ` — ${f.name}` : ''}:**`, '', '| Field | Type | Required | Constraints |', '|---|---|---|---|');
      for (const fl of f.fields) {
        const cons = [fl.pattern && `pattern ${fl.pattern}`, fl.maxLength && `max ${fl.maxLength}`, fl.options?.length && `${fl.options.length} options`]
          .filter(Boolean).join('; ');
        lines.push(`| ${fl.label || fl.name || '—'} | ${fl.type} | ${fl.required ? 'yes' : 'no'} | ${cons || '—'} |`);
      }
      lines.push('');
    }
    if (s.subScreens.length) lines.push(`**Sub-screens:** ${s.subScreens.join(', ')}`, '');
  }
  return lines.join('\n');
}

function renderActions({ actions }) {
  const lines = ['# Action catalogue', '',
    'Every interactive control observed, with what it did. `Instances` counts',
    'repeated occurrences collapsed into one entry (e.g. a per-row Edit button).', '',
    '| ID | Screen | Control | Type | Depth | Effect | API calls | Instances | Verified |',
    '|---|---|---|---|---|---|---|---|---|'];
  for (const a of actions) {
    lines.push(`| ${a.id} | ${a.screen} | ${a.label} | ${a.kind} | ${a.depth} | ${a.effect} | ${a.apiCalls.join('<br>') || '—'} | ${a.instances} | ${a.verified ? '✓' : '—'} |`);
  }
  const unverified = actions.filter((a) => !a.verified);
  if (unverified.length) {
    lines.push('', '## Unverified actions', '',
      'These exist in the UI but were not exercised — write paths blocked by',
      'read-only mode, disabled controls, or failed interactions. Each is still a',
      'feature; its behaviour is inferred rather than observed.', '',
      '| ID | Screen | Control | Reason |', '|---|---|---|---|');
    for (const a of unverified) lines.push(`| ${a.id} | ${a.screen} | ${a.label} | ${a.effect} |`);
  }
  return lines.join('\n');
}

function renderNavigation({ screens, edges }) {
  const lines = ['# Navigation graph', '',
    'Observed edges only. Use this as the skeleton for workflow reconstruction —',
    'but note that it shows *reachability*, not *journeys*. A workflow is a',
    'purposeful path through these edges and has to be inferred.', '',
    '```mermaid', 'graph LR'];
  for (const s of screens) lines.push(`  ${s.id}["${s.name.slice(0, 30)}"]`);
  const seen = new Set();
  for (const e of edges) {
    const k = `${e.from}->${e.to}`;
    if (seen.has(k)) continue;
    seen.add(k);
    lines.push(`  ${e.from} -->|${e.via.slice(0, 20)}| ${String(e.to).replace(/[^A-Za-z0-9.\-]/g, '_')}`);
  }
  lines.push('```', '');
  const orphans = screens.filter((s) => !edges.some((e) => e.to === s.id));
  if (orphans.length) {
    lines.push('## Screens with no observed inbound navigation', '',
      'Reached by direct URL or sitemap. Either the entry point lives behind a',
      'role you did not audit, or behind an interaction the crawl skipped.', '');
    for (const o of orphans) lines.push(`- ${o.id} — \`${o.path}\``);
  }
  return lines.join('\n');
}

function renderCoverage({ manifest, screens, subScreens, actions, gaps }) {
  const byType = gaps.reduce((a, g) => ((a[g.type] = (a[g.type] || 0) + 1), a), {});
  const lines = ['# Coverage report', '',
    `**Target:** ${manifest.baseUrl}`, `**Screens:** ${screens.length}`,
    `**Sub-screens:** ${subScreens.length}`, `**Actions:** ${actions.length}`,
    `**Verified actions:** ${actions.filter((a) => a.verified).length} of ${actions.length}`,
    `**API endpoints:** ${manifest.stats?.apiEndpoints ?? 'n/a'}`, '',
    '## Gaps', ''];
  for (const [t, n] of Object.entries(byType)) lines.push(`- **${t}:** ${n}`);
  lines.push('', '| Type | Reference | Detail |', '|---|---|---|');
  for (const g of gaps.slice(0, 200)) lines.push(`| ${g.type} | ${g.ref} | ${clean(String(g.detail || '')).slice(0, 120)} |`);
  const unswept = manifest.unsweptDiscovered || [];
  const truncated = (manifest.routes || []).filter((r) => r.budgetExhausted);
  if (unswept.length) {
    lines.push('', '## Discovered but never swept', '',
      'Reached by clicking, but `maxRoutes` was hit first. These are real screens',
      'that are entirely absent from the registers above.', '');
    for (const u of unswept) lines.push(`- \`${u}\``);
  }
  if (truncated.length) {
    lines.push('', '## Routes truncated by interaction budget', '',
      '`maxInteractionsPerRoute` was exhausted before the queue emptied, so some',
      'controls on these screens were never tried.', '',
      '| Screen | Controls left in queue |', '|---|---|');
    for (const t of truncated) lines.push(`| \`${t.pathname}\` | ${t.queueRemaining} |`);
  }
  lines.push('', '## Read this before planning against the output', '',
    'Coverage is bounded by the account used. One session state audits one role;',
    'anything gated behind a permission tier you did not hold is absent from these',
    'registers and will not appear as a gap, because the crawler never saw a door',
    'to knock on. State the audited role explicitly when handing this over.');
  return lines.join('\n');
}

// ------------------------------------------------------------------ main ----

const data = await build();
await fs.mkdir(OUTPUT, { recursive: true });

await fs.writeFile(path.join(OUTPUT, 'SCREENS.md'), renderScreens(data));
await fs.writeFile(path.join(OUTPUT, 'ACTIONS.md'), renderActions(data));
await fs.writeFile(path.join(OUTPUT, 'NAVIGATION.md'), renderNavigation(data));
await fs.writeFile(path.join(OUTPUT, 'COVERAGE.md'), renderCoverage(data));
await fs.writeFile(path.join(OUTPUT, 'inventory.json'), JSON.stringify({
  screens: data.screens, subScreens: data.subScreens,
  actions: data.actions, edges: data.edges, gaps: data.gaps,
}, null, 2));

console.log(`\n▸ Inventory written to ${OUTPUT}`);
console.log(`  ${data.screens.length} screens · ${data.subScreens.length} sub-screens · ${data.actions.length} actions · ${data.gaps.length} gaps`);
console.log('  Next: read inventory.json and write WORKFLOWS.md + TASKS.md per references/ba-deliverables.md\n');
