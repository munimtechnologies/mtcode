// MT Code desktop control — Chrome side.
//
// The agent works only in tabs it created, collected into a labelled tab group,
// so the user's own tabs are never touched and they can keep browsing while a
// task runs. Page interaction goes through the DevTools protocol rather than
// synthetic mouse input, which is what makes it work in a *background* tab: a
// window only renders its active tab, so anything coordinate-based would be
// blind the moment the user switches away.
//
// Commands arrive from the desktop app over native messaging; every reply
// carries the originating request id.

const HOST = "com.munim.mtcode.desktop";
// Installs made before the rename registered the host under its old name.
// Chrome rejects an unknown host outright, so try the previous id second
// rather than leaving those browsers unable to reach the desktop at all.
const LEGACY_HOST = "com.t3tools.t3code.desktop";
const GROUP_TITLE = "MT Code";
const OWNED_STATE_KEY = "ownedState";

/**
 * Per-MCP-client ownership. Cursor and MT Code (and extra MCP children) share
 * one extension via the desktop bridge; each process has its own clientId so
 * one client's cleanup cannot close another client's tabs.
 *
 * @typedef {{ tabs: Set<number>, groupId: number|null }} ClientOwned
 * @type {Map<string, ClientOwned>}
 */
const clients = new Map();
/** tabId → clientId, for assertOwned / favicon listeners / onRemoved. */
const tabOwner = new Map();
/** Tabs we have attached the debugger to, so we detach exactly once. */
const attached = new Set();
let port = null;
/** True after the native host has delivered at least one message this session. */
let hadLiveSession = false;
/** When the current native-host port was opened (ms). */
let connectedAt = 0;
/**
 * A host that stays connected this long is treated as a live desktop session,
 * even if it has not sent a command yet (idle reconnect while MCP is up).
 * Shorter disconnects are the usual "MCP not listening yet" race.
 */
const LIVE_SESSION_DWELL_MS = 2000;
let stateReady = null;

function requireClientId(params) {
  const clientId = params && typeof params.clientId === "string" ? params.clientId.trim() : "";
  if (!clientId) throw new Error("clientId is required");
  return clientId;
}

/** @returns {ClientOwned} */
function clientState(clientId) {
  let state = clients.get(clientId);
  if (!state) {
    state = { tabs: new Set(), groupId: null };
    clients.set(clientId, state);
  }
  return state;
}

function groupTitleFor(clientId) {
  // Keep the strip readable: short suffix so two agents are distinguishable.
  const short = clientId.length <= 8 ? clientId : clientId.slice(0, 8);
  return `${GROUP_TITLE} · ${short}`;
}

async function persistOwnedState() {
  try {
    const serialized = {};
    for (const [clientId, state] of clients) {
      serialized[clientId] = {
        tabs: Array.from(state.tabs),
        groupId: state.groupId,
      };
    }
    await chrome.storage.session.set({ [OWNED_STATE_KEY]: { clients: serialized } });
  } catch {
    // Storage can fail in restricted contexts; ownership still works in-memory.
  }
}

async function restoreOwnedState() {
  try {
    const stored = await chrome.storage.session.get(OWNED_STATE_KEY);
    const state = stored?.[OWNED_STATE_KEY];
    if (!state || typeof state !== "object") return;

    clients.clear();
    tabOwner.clear();

    // Legacy single-owner shape: { tabs, groupId }.
    if (Array.isArray(state.tabs)) {
      const legacy = clientState("legacy");
      for (const tabId of state.tabs) {
        if (typeof tabId !== "number") continue;
        try {
          await chrome.tabs.get(tabId);
          legacy.tabs.add(tabId);
          tabOwner.set(tabId, "legacy");
        } catch {
          // Tab closed while the service worker was asleep.
        }
      }
      legacy.groupId = typeof state.groupId === "number" ? state.groupId : null;
      if (legacy.groupId !== null) {
        try {
          await chrome.tabGroups.get(legacy.groupId);
        } catch {
          legacy.groupId = null;
        }
      }
      await persistOwnedState();
      return;
    }

    const serialized = state.clients && typeof state.clients === "object" ? state.clients : {};
    for (const [clientId, entry] of Object.entries(serialized)) {
      if (!entry || typeof entry !== "object") continue;
      const next = clientState(clientId);
      for (const tabId of Array.isArray(entry.tabs) ? entry.tabs : []) {
        if (typeof tabId !== "number") continue;
        try {
          await chrome.tabs.get(tabId);
          next.tabs.add(tabId);
          tabOwner.set(tabId, clientId);
        } catch {
          // Tab closed while the service worker was asleep.
        }
      }
      next.groupId = typeof entry.groupId === "number" ? entry.groupId : null;
      if (next.groupId !== null) {
        try {
          await chrome.tabGroups.get(next.groupId);
        } catch {
          next.groupId = null;
        }
      }
    }
    await persistOwnedState();
  } catch {
    // Fresh start if session storage is unavailable.
  }
}

function ensureStateReady() {
  if (!stateReady) stateReady = restoreOwnedState();
  return stateReady;
}

// ── native messaging ────────────────────────────────────────────────────────

function connect() {
  if (port) return;
  // Chrome throws for a host id it has no manifest for, so try the current
  // name first and fall back to the pre-rename one. Installs that still carry
  // only the old manifest keep working until they run the installer again.
  for (const host of [HOST, LEGACY_HOST]) {
    try {
      port = chrome.runtime.connectNative(host);
      break;
    } catch {
      port = null;
    }
  }
  if (!port) return;
  const sessionPort = port;
  connectedAt = Date.now();
  hadLiveSession = false;
  sessionPort.onMessage.addListener((msg) => {
    // A command proves the MCP bridge is up.
    hadLiveSession = true;
    void handleCommand(msg, sessionPort);
  });
  sessionPort.onDisconnect.addListener(() => {
    // Reading lastError here keeps "Native host has exited" out of the error
    // list while the desktop app simply is not running yet.
    void chrome.runtime.lastError;
    const livedMs = connectedAt ? Date.now() - connectedAt : 0;
    // Tear down tabs when a real session ends: either we saw traffic, or the
    // host stayed up long enough that this was not a connectNative race.
    // Immediate disconnects (MCP pipe not bound yet) keep restored tabs.
    // Native-host drop means every MCP client lost the bridge — close all.
    const wasLive = hadLiveSession || livedMs >= LIVE_SESSION_DWELL_MS;
    const snapshot = wasLive
      ? Array.from(clients.entries()).map(([clientId, state]) => ({
          clientId,
          tabs: Array.from(state.tabs),
          groupId: state.groupId,
        }))
      : [];
    if (port === sessionPort) {
      port = null;
      hadLiveSession = false;
      connectedAt = 0;
    }
    for (const entry of snapshot) {
      for (const tabId of entry.tabs) void hideCursor(tabId);
      void closeOwnedTabs(entry.clientId, entry.tabs, entry.groupId);
    }
  });
}

// The desktop app comes and goes with the user's session, so reconnect on a
// schedule. An alarm rather than setTimeout: a service worker is terminated
// when idle and timers do not survive that, which would strand the connection
// until the user reloaded the extension by hand.
// Chrome clamps alarm periods to a minute, so ask for what we will get.
chrome.alarms.create("t3-reconnect", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "t3-reconnect") connect();
});
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
// Connect as soon as the service worker evaluates. onStartup/onInstalled alone
// can miss unpacked loads; content-script pings also wake us via onMessage.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "t3-wake") connect();
});
connect();

function reply(portRef, id, result) {
  try {
    portRef?.postMessage({ id, ok: true, result });
  } catch {
    // Port went away mid-command; drop the reply.
  }
}

function replyError(portRef, id, message) {
  try {
    portRef?.postMessage({ id, ok: false, error: String(message) });
  } catch {
    // Port went away mid-command; drop the reply.
  }
}

// ── tab + group management ──────────────────────────────────────────────────

/** Serialize group mutation so concurrent open_tab calls share one group. */
const groupQueue = (() => {
  let chain = Promise.resolve();
  return (task) => {
    const run = chain.then(task, task);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
})();

async function ensureGroup(clientId, tabId) {
  return groupQueue(async () => {
    const state = clientState(clientId);
    // Re-create the group if the user dismissed it or Chrome dropped it.
    if (state.groupId !== null) {
      try {
        await chrome.tabGroups.get(state.groupId);
      } catch {
        state.groupId = null;
      }
    }
    if (state.groupId === null) {
      state.groupId = await chrome.tabs.group({ tabIds: [tabId] });
      await chrome.tabGroups.update(state.groupId, {
        title: groupTitleFor(clientId),
        color: "blue",
      });
    } else {
      await chrome.tabs.group({ groupId: state.groupId, tabIds: [tabId] });
    }
    // Agent tabs get the pointer favicon (not the T3 toolbar logo) as soon as
    // they join the group, so the strip reads as "agent-owned" before the first click.
    await markTab(tabId);
    await persistOwnedState();
    return state.groupId;
  });
}

async function openTab(clientId, url) {
  // active:false is the whole point — the user stays on whatever they were doing.
  const tab = await chrome.tabs.create({ url: url || "about:blank", active: false });
  const state = clientState(clientId);
  state.tabs.add(tab.id);
  tabOwner.set(tab.id, clientId);
  await ensureGroup(clientId, tab.id);
  await persistOwnedState();
  // Pages replace their favicon on load (Spotify, YouTube, …). Re-apply the
  // pointer whenever the document finishes, and also when the tab's own icon
  // changes, so the strip stays on the agent cursor rather than the site logo.
  chrome.tabs.onUpdated.addListener(function badge(id, info) {
    if (id !== tab.id) return;
    if (info.status === "complete" || info.favIconUrl) markTab(tab.id);
    if (!tabOwner.has(tab.id)) chrome.tabs.onUpdated.removeListener(badge);
  });
  return { tabId: tab.id, url: tab.url, title: tab.title, clientId };
}

async function listTabs(clientId) {
  const state = clientState(clientId);
  const out = [];
  // Snapshot first: the loop drops ids for tabs the user closed behind us.
  const known = Array.from(state.tabs);
  for (const tabId of known) {
    try {
      const tab = await chrome.tabs.get(tabId);
      out.push({ tabId, title: tab.title, url: tab.url, active: tab.active });
    } catch {
      state.tabs.delete(tabId);
      tabOwner.delete(tabId);
    }
  }
  return { groupId: state.groupId, tabs: out, clientId };
}

/// Close a captured set of one client's agent tabs. Only mutates that client's
/// ownership so a peer MCP client's tabs survive.
async function closeOwnedTabs(clientId, ids, expectedGroupId) {
  const state = clients.get(clientId);
  for (const id of ids) {
    if (state) state.tabs.delete(id);
    tabOwner.delete(id);
    attached.delete(id);
    try {
      await chrome.tabs.remove(id);
    } catch {
      // Already closed by the user; nothing to do.
    }
  }
  if (state && expectedGroupId !== null && state.groupId === expectedGroupId) {
    try {
      const remaining = await chrome.tabs.query({ groupId: expectedGroupId });
      // Ungroup stragglers that are not part of this client's owned set — a
      // reconnect may already have placed new agent tabs in this same group.
      const leftover = remaining.filter((t) => !state.tabs.has(t.id));
      if (leftover.length) await chrome.tabs.ungroup(leftover.map((t) => t.id));
    } catch {
      // The group is already gone.
    }
    if (state.groupId === expectedGroupId && state.tabs.size === 0) {
      state.groupId = null;
    }
  }
  if (state && state.tabs.size === 0 && state.groupId === null) {
    clients.delete(clientId);
  }
  await persistOwnedState();
  return { closed: ids.length, clientId };
}

async function closeAllTabs(clientId) {
  const state = clientState(clientId);
  return closeOwnedTabs(clientId, Array.from(state.tabs), state.groupId);
}

function assertOwned(clientId, tabId) {
  if (tabOwner.get(tabId) !== clientId) {
    throw new Error(`tab ${tabId} is not one of this agent's tabs`);
  }
}

// ── DevTools protocol ───────────────────────────────────────────────────────

async function attach(tabId) {
  if (attached.has(tabId)) return;
  await chrome.debugger.attach({ tabId }, "1.3");
  attached.add(tabId);
}

async function send(tabId, method, params = {}) {
  await attach(tabId);
  return chrome.debugger.sendCommand({ tabId }, method, params);
}

/// A compact outline of the interactive elements on the page, with ids the
/// agent can click. Mirrors the accessibility-tree tools on the desktop side.
const SNAPSHOT_JS = `(() => {
  const out = [];
  const sel = 'a,button,input,textarea,select,cfc-select,mat-option,[role=button],[role=link],[role=textbox],[role=combobox],[role=listbox],[role=option],[role=menu],[role=menuitem],[aria-haspopup],[contenteditable=true],summary';
  let i = 0;
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') continue;
    const label = (el.getAttribute('aria-label') || el.innerText || el.value ||
                   el.getAttribute('title') || el.getAttribute('placeholder') || '')
                  .replace(/\\s+/g, ' ').trim().slice(0, 90);
    el.setAttribute('data-t3-idx', String(i));
    out.push({
      i: i++,
      tag: el.tagName.toLowerCase(),
      label,
      x: Math.round(r.left + r.width / 2),
      y: Math.round(r.top + r.height / 2),
      inView: r.top >= 0 && r.bottom <= innerHeight,
    });
    if (i >= 250) break;
  }
  return { title: document.title, url: location.href, elements: out };
})()`;

async function snapshot(tabId) {
  const res = await send(tabId, "Runtime.evaluate", {
    expression: SNAPSHOT_JS,
    returnByValue: true,
  });
  if (res?.exceptionDetails) throw new Error(res.exceptionDetails.text || "evaluate failed");
  return res.result.value;
}

async function clickAt(tabId, x, y) {
  // Show the same agent pointer the desktop overlay uses, painted into the page.
  const cursor = await paintCursor(tabId, x, y);
  // A hover first, then press/release carrying the button bitmask. Single-page
  // apps route clicks through pointer/hover handlers, and without the leading
  // mouseMoved (or with buttons unset) the press lands on nothing.
  await send(tabId, "Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x,
    y,
    button: "none",
    buttons: 0,
    pointerType: "mouse",
  });
  await send(tabId, "Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    buttons: 1,
    clickCount: 1,
    pointerType: "mouse",
  });
  await send(tabId, "Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    buttons: 0,
    clickCount: 1,
    pointerType: "mouse",
  });
  await markTab(tabId);
  return { clicked: { x, y }, cursor };
}

/// The agent cursor, drawn into the page itself so a controlled tab shows the
/// same pointer as the desktop overlay. Fixed-position, pointer-events:none and
/// max z-index, so it is purely decorative and cannot intercept anything.
///
/// Uses the PNG rendered from BubbleView in AgentCursor.swift (not a hand-traced
/// SVG) so Chrome and desktop stay pixel-matched: same glow, fill, rim, shape.
/// The overlay asset is the 2x render (224px shown at 112 CSS px) so it stays as
/// crisp as the desktop panel on Retina/HiDPI displays; the 1x file is kept for
/// the tab favicon.
/// Motion mirrors the desktop overlay: slow fade-in, cubic flight with tip
/// following path tangent, and fade-out after Computer Use tools stop (not a
/// short idle after the last pixel move).
const CURSOR_IMG_URL = chrome.runtime.getURL("icons/cursor-224.png");
const CURSOR_HOTSPOT = 56; // OverlayController.hotspot — tip at centre of 112×112
const CURSOR_FADE_IN_MS = 500;
const CURSOR_FADE_OUT_MS = 350;
/** Match desktop `T3_DESKTOP_AGENT_CURSOR_TASK_FADE_SECS` default (8s). */
const CURSOR_TASK_FADE_MS = 8000;

const PAINT_CURSOR_JS = `
  (function paint(x, y, src, fadeInMs, fadeOutMs, taskFadeMs, hotspot) {
    const ID = '__t3AgentCursor';
    const easeInOut = (t) => t * t * (3 - 2 * t);
    const bezier = (p0, p1, p2, p3, t) => {
      const u = 1 - t;
      return u*u*u*p0 + 3*u*u*t*p1 + 3*u*t*t*p2 + t*t*t*p3;
    };
    const bezierTan = (p0, p1, p2, p3, t) => {
      const u = 1 - t;
      return 3*u*u*(p1-p0) + 6*u*t*(p2-p1) + 3*t*t*(p3-p2);
    };

    let el = document.getElementById(ID);
    if (!el) {
      el = document.createElement('div');
      el.id = ID;
      el.style.cssText = 'position:fixed;left:0;top:0;width:112px;height:112px;' +
        'pointer-events:none;z-index:2147483647;opacity:0;will-change:transform,opacity;' +
        'transform-origin:' + hotspot + 'px ' + hotspot + 'px;';
      // Same artwork as desktop BubbleView / T3AgentCursor (cursor-224.png, 2x).
      const img = document.createElement('img');
      img.src = src;
      img.width = 112;
      img.height = 112;
      img.alt = '';
      img.draggable = false;
      img.style.cssText = 'display:block;width:112px;height:112px;' +
        'transform-origin:' + hotspot + 'px ' + hotspot + 'px;will-change:transform;';
      el.appendChild(img);
      (document.documentElement || document.body).appendChild(el);
      el.__t3 = { x: x, y: y, tilt: 0, arc: 1, raf: 0, breatheRaf: 0, phase: 0 };
    } else {
      const img = el.querySelector('img');
      if (img && img.src !== src) img.src = src;
    }

    const st = el.__t3 || (el.__t3 = { x: x, y: y, tilt: 0, arc: 1, raf: 0, breatheRaf: 0, phase: 0 });
    if (st.raf) { cancelAnimationFrame(st.raf); st.raf = 0; }
    clearTimeout(el.__t3hide);

    // Idle breathe matches BubbleView: scale 1 + 0.03*sin(phase) on the artwork.
    const ensureBreathe = () => {
      if (st.breatheRaf) return;
      const tick = () => {
        const img = el.querySelector('img');
        if (!img || parseFloat(getComputedStyle(el).opacity) < 0.05) {
          st.breatheRaf = 0;
          if (img) img.style.transform = '';
          return;
        }
        st.phase = (st.phase || 0) + 0.045;
        const breathe = 1 + 0.03 * Math.sin(st.phase);
        img.style.transform = 'scale(' + breathe + ')';
        st.breatheRaf = requestAnimationFrame(tick);
      };
      st.breatheRaf = requestAnimationFrame(tick);
    };

    const place = (px, py, tilt) => {
      st.x = px; st.y = py; st.tilt = tilt;
      el.style.transform = 'translate(' + (px - hotspot) + 'px,' + (py - hotspot) +
        'px) rotate(' + tilt + 'rad)';
    };

    const fromX = st.x;
    const fromY = st.y;
    const dx = x - fromX;
    const dy = y - fromY;
    const dist = Math.hypot(dx, dy);
    const fresh = parseFloat(getComputedStyle(el).opacity) < 0.05;

    let waitMs = 80;
    if (fresh) {
      place(x, y, 0);
      el.style.transition = 'opacity ' + fadeInMs + 'ms ease-out';
      // Force style flush so the opacity transition runs from 0.
      void el.offsetWidth;
      el.style.opacity = '1';
      ensureBreathe();
      waitMs = fadeInMs + 40;
    } else if (dist < 3) {
      el.style.transition = 'opacity ' + fadeInMs + 'ms ease-out';
      el.style.opacity = '1';
      place(x, y, 0);
      ensureBreathe();
      waitMs = 60;
    } else {
      el.style.transition = 'opacity 120ms linear';
      el.style.opacity = '1';
      ensureBreathe();
      st.arc *= -1;
      const handle = Math.min(72, Math.max(22, dist * 0.18));
      const nx = -dy / dist;
      const ny = dx / dist;
      let sdx, sdy;
      if (Math.abs(st.tilt) > 0.08) {
        sdx = Math.sin(-st.tilt);
        sdy = -Math.cos(-st.tilt);
      } else {
        sdx = dx / dist;
        sdy = dy / dist;
      }
      const depart = Math.min(handle, dist * 0.28);
      const c1x = fromX + sdx * depart + nx * Math.min(36, dist * 0.10) * st.arc;
      const c1y = fromY + sdy * depart + ny * Math.min(36, dist * 0.10) * st.arc;
      // Approach from below so final tangent is screen-up → tip upright on land.
      const approach = Math.min(handle * 0.85, Math.max(20, dist * 0.16));
      const c2x = x;
      const c2y = y + approach;
      const duration = Math.min(0.85, Math.max(0.28, 0.20 + dist / 1100.0));
      waitMs = Math.round(duration * 1000) + 40;
      const t0 = performance.now();
      const tick = (now) => {
        const u = Math.min(1, (now - t0) / (duration * 1000));
        const t = easeInOut(u);
        const px = bezier(fromX, c1x, c2x, x, t);
        const py = bezier(fromY, c1y, c2y, y, t);
        const tx = bezierTan(fromX, c1x, c2x, x, t);
        const ty = bezierTan(fromY, c1y, c2y, y, t);
        let tilt = st.tilt;
        const len = Math.hypot(tx, ty);
        if (len > 0.001) {
          const desired = -Math.atan2(tx, -ty);
          let delta = desired - tilt;
          while (delta > Math.PI) delta -= Math.PI * 2;
          while (delta < -Math.PI) delta += Math.PI * 2;
          tilt += delta * Math.min(1, 0.12 + t * 0.55);
        }
        if (u >= 1) tilt = 0;
        place(px, py, tilt);
        if (u < 1) {
          st.raf = requestAnimationFrame(tick);
        } else {
          st.raf = 0;
          place(x, y, 0);
        }
      };
      st.raf = requestAnimationFrame(tick);
    }

    el.__t3hide = setTimeout(function () {
      if (st.breatheRaf) { cancelAnimationFrame(st.breatheRaf); st.breatheRaf = 0; }
      const img = el.querySelector('img');
      if (img) img.style.transform = '';
      el.style.transition = 'opacity ' + fadeOutMs + 'ms ease';
      el.style.opacity = '0';
    }, taskFadeMs);

    return {
      ok: true,
      waitMs: waitMs,
      fresh: fresh,
      dist: dist
    };
  })
`;

async function paintCursor(tabId, x, y) {
  try {
    const res = await send(tabId, "Runtime.evaluate", {
      expression:
        `(() => {` +
        `  const r = (${PAINT_CURSOR_JS})(${Number(x)}, ${Number(y)}, ${JSON.stringify(CURSOR_IMG_URL)},` +
        `    ${CURSOR_FADE_IN_MS}, ${CURSOR_FADE_OUT_MS}, ${CURSOR_TASK_FADE_MS}, ${CURSOR_HOTSPOT});` +
        `  const el = document.getElementById('__t3AgentCursor');` +
        `  if (!el) return { ok: false, reason: 'paint produced no element' };` +
        `  const img = el.querySelector('img');` +
        `  return Object.assign({}, r, {` +
        `    hasGlow: !!(img && /cursor-(?:112|224)\\.png/.test(img.src)),` +
        `    darkFill: !!(img && /cursor-(?:112|224)\\.png/.test(img.src)),` +
        `    transform: el.style.transform || ''` +
        `  });` +
        `})()`,
      returnByValue: true,
    });
    if (res?.exceptionDetails) {
      return { ok: false, reason: res.exceptionDetails.text || "paint evaluate failed" };
    }
    const value = res?.result?.value || { ok: false, reason: "empty paint result" };
    const waitMs = Math.max(0, Math.min(1200, Number(value.waitMs) || 0));
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    return value;
  } catch (e) {
    // Decorative only — a paint failure must never fail the click.
    return { ok: false, reason: e && e.message ? e.message : String(e) };
  }
}

async function hideCursor(tabId) {
  try {
    await send(tabId, "Runtime.evaluate", {
      expression:
        `(() => {` +
        `  const el = document.getElementById('__t3AgentCursor');` +
        `  if (!el) return false;` +
        `  clearTimeout(el.__t3hide);` +
        `  if (el.__t3 && el.__t3.raf) cancelAnimationFrame(el.__t3.raf);` +
        `  if (el.__t3 && el.__t3.breatheRaf) cancelAnimationFrame(el.__t3.breatheRaf);` +
        `  if (el.__t3) { el.__t3.raf = 0; el.__t3.breatheRaf = 0; }` +
        `  const img = el.querySelector('img');` +
        `  if (img) img.style.transform = '';` +
        `  el.style.transition = 'opacity ${CURSOR_FADE_OUT_MS}ms ease';` +
        `  el.style.opacity = '0';` +
        `  return true;` +
        `})()`,
      returnByValue: true,
    });
  } catch {
    // Tab may already be gone.
  }
}

const CLICK_JS = (index) => `(() => {
  const el = document.querySelector('[data-t3-idx="${index}"]');
  if (!el) return { ok: false, reason: 'element ${index} is no longer on the page' };
  el.scrollIntoView({ block: 'center', inline: 'nearest' });
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const opts = { bubbles: true, cancelable: true, composed: true, view: window,
                 clientX: cx, clientY: cy, button: 0 };
  el.dispatchEvent(new PointerEvent('pointerover', opts));
  el.dispatchEvent(new MouseEvent('mouseover', opts));
  el.dispatchEvent(new PointerEvent('pointerdown', opts));
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.focus?.();
  el.dispatchEvent(new PointerEvent('pointerup', opts));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  el.click();
  return { ok: true, tag: el.tagName.toLowerCase(), href: el.href || null, x: cx, y: cy };
})()`;

/// Click a snapshotted element by invoking it in the page.
///
/// Coordinate dispatch is unreliable here: a background tab is not composited,
/// so hit-testing a point finds nothing and the click silently does nothing.
/// Driving the node directly works regardless of whether the tab is rendered,
/// which is the whole point of working in a tab the user is not looking at.
async function clickElement(tabId, index) {
  const res = await send(tabId, "Runtime.evaluate", {
    expression: CLICK_JS(index),
    returnByValue: true,
    userGesture: true,
  });
  if (res?.exceptionDetails) throw new Error(res.exceptionDetails.text || "click failed");
  const value = res.result.value || {};
  if (!value.ok) throw new Error(value.reason || "click failed");
  const cursor = await paintCursor(tabId, value.x, value.y);
  await markTab(tabId);
  return { ...value, cursor };
}

async function typeText(tabId, text) {
  await send(tabId, "Input.insertText", { text });
  await markTab(tabId);
  return { typed: text.length };
}

async function pressKey(tabId, key) {
  const map = {
    Enter: { windowsVirtualKeyCode: 13, key: "Enter", text: "\r" },
    Tab: { windowsVirtualKeyCode: 9, key: "Tab" },
    Escape: { windowsVirtualKeyCode: 27, key: "Escape" },
    Backspace: { windowsVirtualKeyCode: 8, key: "Backspace" },
  };
  const spec = map[key];
  if (!spec) throw new Error(`unsupported key: ${key}`);
  await send(tabId, "Input.dispatchKeyEvent", { type: "keyDown", ...spec });
  await send(tabId, "Input.dispatchKeyEvent", { type: "keyUp", ...spec });
  return { pressed: key };
}

async function screenshot(tabId) {
  // Page.captureScreenshot works on a background tab; captureVisibleTab does not.
  const res = await send(tabId, "Page.captureScreenshot", { format: "png" });
  return { data: res.data };
}

async function navigate(tabId, url) {
  await chrome.tabs.update(tabId, { url });
  return { tabId, url };
}

// ── "the agent is using this tab" indicator ─────────────────────────────────
//
// Toolbar icon = T3 logo (manifest icons/). Tab favicon = the same Computer Use
// cursor PNG the page overlay paints (icons/cursor-112.png) — one source of
// truth with BubbleView / T3AgentCursor, scaled by Chrome in the tab strip.
//
// An extension cannot set a tab's favicon directly, but it can replace the
// page's icon link, which is what Chrome renders in the tab strip. Pages
// rewrite their own favicon (YouTube does it for notifications), so this is
// re-applied on group join, load, favicon changes, and after each interaction.

function applyFavicon(url) {
  for (const link of document.querySelectorAll("link[rel~='icon'], link[rel='shortcut icon']")) {
    link.remove();
  }
  const link = document.createElement("link");
  link.rel = "icon";
  link.type = "image/png";
  link.href = url;
  document.head.appendChild(link);
}

async function markTab(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: applyFavicon,
      args: [chrome.runtime.getURL("icons/cursor-112.png")],
    });
  } catch {
    // Chrome's own pages (chrome://, the Web Store) refuse injection; the tab
    // still works, it just cannot show the badge.
  }
}

// ── dispatch ────────────────────────────────────────────────────────────────

const handlers = {
  ping: async () => ({ pong: true }),
  open_tab: async (p) => openTab(requireClientId(p), p.url),
  list_tabs: async (p) => listTabs(requireClientId(p)),
  select_tab: async (p) => {
    const clientId = requireClientId(p);
    assertOwned(clientId, p.tabId);
    // The tool contract is "make one of the agent's tabs the visible one. Does
    // not affect the user's tabs" — but activating unconditionally yanked the
    // window away from whatever the user was doing, mid-typing, which is the
    // one thing openTab's `active:false` exists to prevent. Everything the
    // agent needs (insertText, dispatchKeyEvent, Page.captureScreenshot) works
    // on a background tab, so focus only moves when the user is already
    // looking at an agent tab; otherwise the switch is recorded silently and
    // the user keeps typing where they were.
    const target = await chrome.tabs.get(p.tabId);
    const [active] = await chrome.tabs.query({ active: true, windowId: target.windowId });
    const userIsOnAgentTab = active?.id !== undefined && tabOwner.get(active.id) === clientId;
    if (userIsOnAgentTab) {
      await chrome.tabs.update(p.tabId, { active: true });
    }
    return { tabId: p.tabId, activated: userIsOnAgentTab };
  },
  close_all_tabs: async (p) => closeAllTabs(requireClientId(p)),
  close_tab: async (p) => {
    const clientId = requireClientId(p);
    assertOwned(clientId, p.tabId);
    await chrome.tabs.remove(p.tabId);
    const state = clientState(clientId);
    state.tabs.delete(p.tabId);
    tabOwner.delete(p.tabId);
    attached.delete(p.tabId);
    await persistOwnedState();
    return { closed: p.tabId };
  },
  navigate: async (p) => {
    assertOwned(requireClientId(p), p.tabId);
    return navigate(p.tabId, p.url);
  },
  snapshot: async (p) => {
    assertOwned(requireClientId(p), p.tabId);
    return snapshot(p.tabId);
  },
  click: async (p) => {
    assertOwned(requireClientId(p), p.tabId);
    return p.index !== undefined ? clickElement(p.tabId, p.index) : clickAt(p.tabId, p.x, p.y);
  },
  type: async (p) => {
    assertOwned(requireClientId(p), p.tabId);
    return typeText(p.tabId, p.text);
  },
  press: async (p) => {
    assertOwned(requireClientId(p), p.tabId);
    return pressKey(p.tabId, p.key);
  },
  screenshot: async (p) => {
    assertOwned(requireClientId(p), p.tabId);
    return screenshot(p.tabId);
  },
};

async function handleCommand(msg, replyPort = port) {
  await ensureStateReady();
  const { id, command, params } = msg || {};
  const handler = handlers[command];
  if (!handler) return replyError(replyPort, id, `unknown command: ${command}`);
  try {
    reply(replyPort, id, await handler(params || {}));
  } catch (e) {
    replyError(replyPort, id, e && e.message ? e.message : e);
  }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  if (!tabOwner.has(tabId) && !attached.has(tabId)) return;
  const clientId = tabOwner.get(tabId);
  if (clientId) clients.get(clientId)?.tabs.delete(tabId);
  tabOwner.delete(tabId);
  attached.delete(tabId);
  void persistOwnedState();
});

void ensureStateReady().then(connect);
