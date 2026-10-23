'use strict';

/* ================================================================
   TripLock prototype
   - Switch between Arjun (organiser) and Riya (a friend) at the top.
   - The other six friends are simulated with the purple demo buttons.
   - Everything runs in the browser. Nothing is saved or sent.
   ================================================================ */

/* ---------- Constants ---------- */

const TOKENS = { lock: 3, passport: 2, visa: 2, reply: 1, instalment: 2 };

const TASKS = [
  { id: 'lock', label: 'Lock in before the deadline' },
  { id: 'passport', label: 'Add passport details' },
  { id: 'visa', label: 'Mark your visa as sorted (self-declared)' },
  { id: 'reply', label: 'Reply to a group decision within 24 hours' },
  { id: 'instalment', label: 'Pay the 2nd instalment on time' }
];

const BUDGETS = [25000, 35000, 45000, 55000, 65000];

const SCREENS = [
  { n: 1, short: 'Create', title: 'Create trip and share', org: true },
  { n: 2, short: 'Vote', title: 'Join and vote your budget' },
  { n: 3, short: 'Reveal', title: 'The budget reveal' },
  { n: 4, short: 'Set up', title: 'Set up the lock-in', org: true },
  { n: 5, short: 'Lock in', title: 'Lock my spot' },
  { n: 6, short: 'Board', title: 'Trip board' },
  { n: 7, short: 'Perks', title: 'Tokens and captain’s choice' }
];

const PEOPLE = [
  { id: 'arjun', name: 'Arjun' },
  { id: 'riya', name: 'Riya' },
  { id: 'karan', name: 'Karan' },
  { id: 'sneha', name: 'Sneha' },
  { id: 'vikram', name: 'Vikram' },
  { id: 'priya', name: 'Priya' },
  { id: 'rohan', name: 'Rohan' },
  { id: 'aisha', name: 'Aisha' }
];

// How each simulated friend behaves (Aisha never votes, like a real group)
const SIM = {
  karan: { vote: 55000, tasks: ['passport', 'visa'], bid: { d: 'd2', amount: 3, pick: 1 } },
  sneha: { vote: 45000, tasks: ['passport'] },
  vikram: { vote: 65000, tasks: ['passport', 'visa', 'reply'], bid: { d: 'd1', amount: 4, pick: 0 } },
  priya: { vote: 55000, tasks: [] },
  rohan: { vote: 45000, tasks: ['reply'] },
  aisha: { vote: null, tasks: [] }
};
const SIM_ORDER = Object.keys(SIM);

const MAX_CAPTAIN = 2;   // decisions one person can captain
const MIN_BID = 2;       // tokens needed to captain an unclaimed decision
const MIN_VOTES = 3;     // votes needed before a reveal, so nobody can be singled out

/* ---------- State ---------- */

function initialState() {
  return {
    role: 'organiser',
    screen: 1,
    created: false,
    trip: {
      name: 'Bali after placements',
      destination: 'Bali',
      window: '10 to 20 Jan 2027',
      voteCloses: 'Sun, 1 Nov'
    },
    members: PEOPLE.map(p => ({
      ...p,
      joined: p.id === 'arjun',
      vote: p.id === 'arjun' ? 55000 : null,
      locked: false,
      lockOrder: null,
      tokens: 0,
      earned: 0,
      tasks: { lock: false, passport: false, visa: false, reply: false, instalment: false }
    })),
    pendingVote: null,
    changingVote: false,
    revealed: false,
    ceiling: null,
    lockin: { started: false, estimate: 0, deposit: 0, threshold: 6, deadline: '2026-11-15' },
    nextLockOrder: 1,
    booked: false,
    bookedAmount: 0,
    cancelled: false,
    decisions: [
      { id: 'd1', title: 'Day 3 activity', options: ['Nusa Penida day tour', 'Beach club in Canggu', 'Free day'], included: true, captain: null, bid: 0, pick: null, closed: false },
      { id: 'd2', title: 'Last-night dinner', options: ['Seafood on Jimbaran beach', 'Rooftop in Seminyak', 'Local warung crawl'], included: true, captain: null, bid: 0, pick: null, closed: false },
      { id: 'd3', title: 'Getting around Ubud', options: ['Private driver', 'Scooters', 'Grab rides'], included: true, captain: null, bid: 0, pick: null, closed: false }
    ],
    selections: {},
    flash: null
  };
}

let state = initialState();

/* ---------- Helpers ---------- */

const $ = sel => document.querySelector(sel);
const fmt = n => '₹' + Math.round(n).toLocaleString('en-IN');
const fmtBudget = n => (n >= 65000 ? fmt(n) + '+' : fmt(n));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isOrg = () => state.role === 'organiser';
const member = id => state.members.find(m => m.id === id);
const me = () => member(isOrg() ? 'arjun' : 'riya');
const voters = () => state.members.filter(m => m.vote != null);
const lockedList = () => state.members.filter(m => m.locked).sort((a, b) => a.lockOrder - b.lockOrder);
const isOn = () => state.lockin.started && !state.cancelled && lockedList().length >= state.lockin.threshold;
const pageUrl = () => location.href.split('#')[0];
const destName = () => state.trip.destination.trim() || 'The trip';

function fmtDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

function isoDate(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function earnTask(m, id) {
  if (m.tasks[id]) return false;
  m.tasks[id] = true;
  m.tokens += TOKENS[id];
  m.earned += TOKENS[id];
  return true;
}

function lockMember(m) {
  m.locked = true;
  m.joined = true;
  m.lockOrder = state.nextLockOrder++;
  earnTask(m, 'lock');
}

function instalmentAmount() {
  const L = state.lockin;
  return Math.max(0, Math.round((L.estimate - L.deposit) / 2 / 500) * 500);
}

/* ---------- Toast and modal ---------- */

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

let modalActions = [];
function modal({ title, body, actions }) {
  modalActions = actions;
  const el = $('#modal');
  el.innerHTML = `
    <div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <h2 id="modal-title">${title}</h2>
      <div>${body}</div>
      <div class="btn-row end">
        ${actions.map((a, i) => `<button type="button" class="btn ${a.cls || 'secondary'}" data-modal="${i}">${a.label}</button>`).join('')}
      </div>
    </div>`;
  el.hidden = false;
  const first = el.querySelector('input') || el.querySelector('.btn.primary');
  if (first) first.focus();
}
function closeModal() {
  const el = $('#modal');
  el.hidden = true;
  el.innerHTML = '';
  modalActions = [];
}

function copyText(text) {
  const done = () => toast('Link copied');
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { toast('Copy failed. The link is ' + text); }
    ta.remove();
  };
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(done, fallback);
  } else {
    fallback();
  }
}

/* ---------- Shared pieces of UI ---------- */

function orgOnly(what) {
  return `
    <section class="card locked-note">
      <div class="big-icon">👑</div>
      <h2>Only the organiser sees this</h2>
      <p class="muted">${what} happens on Arjun’s phone. Friends never see this screen.</p>
      <button type="button" class="btn primary" data-action="role" data-role="organiser">Switch to Arjun</button>
    </section>`;
}

function waiting(title, sub, goTo) {
  return `
    <section class="card locked-note">
      <div class="big-icon">⏳</div>
      <h2>${title}</h2>
      <p class="muted">${sub}</p>
      ${goTo ? `<button type="button" class="btn secondary" data-action="go" data-screen="${goTo}">Go to step ${goTo}</button>` : ''}
    </section>`;
}

function tripCard(extra = '') {
  const t = state.trip;
  return `
    <section class="trip-card">
      <div class="trip-emoji" aria-hidden="true">🌴</div>
      <div>
        <div class="trip-name">${esc(t.name)}</div>
        <div class="small muted">${esc(destName())}, ${esc(t.window)}</div>
        <div class="small muted">Organised by Arjun 👑</div>
        ${extra}
      </div>
    </section>`;
}

function orgPanel(inner) {
  return `
    <section class="card org-panel">
      <div class="org-head">👑 Organiser controls <span>Only Arjun sees this box</span></div>
      ${inner}
    </section>`;
}

function simButton(label, action) {
  return `
    <button type="button" class="btn demo block" data-action="${action}">▶ ${label}</button>
    <p class="demo-note">Demo button. It stands in for friends acting on their own phones.</p>`;
}

function progressBar() {
  const n = lockedList().length;
  const t = state.lockin.threshold;
  const pct = Math.min(100, (n / t) * 100);
  return `
    <div class="progress-label">
      <span><strong>${n} of ${t}</strong> needed have locked in</span>
      <span>${fmt(n * state.lockin.deposit)} collected</span>
    </div>
    <div class="progress ${n >= t ? 'full' : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="${t}" aria-valuenow="${n}">
      <div style="width:${pct}%"></div>
    </div>`;
}

function sharePanel(msg, hint, nextScreen) {
  return `
    <section class="card">
      <h3>Share on WhatsApp</h3>
      <p class="muted small">This message goes into your existing group chat.</p>
      <div class="wa-preview"><div class="wa-bubble">${esc(msg)}<span class="wa-time">now ✓✓</span></div></div>
      <div class="btn-row">
        <a class="btn whatsapp" href="https://wa.me/?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">Share on WhatsApp</a>
        <button type="button" class="btn secondary" data-action="copy">Copy link</button>
      </div>
      <div class="next-hint">
        ${hint}
        <button type="button" class="btn primary block" data-action="asRiya" data-screen="${nextScreen}">Open the link as Riya</button>
      </div>
    </section>`;
}

function voteMessage() {
  return `${state.trip.name}? 🌴
Vote your budget privately. Nobody sees your number, not even me.
Takes 30 seconds: ${pageUrl()}
Voting closes ${state.trip.voteCloses}.`;
}

function lockMessage() {
  const L = state.lockin;
  return `${state.trip.name} is happening if ${L.threshold} of us lock in by ${fmtDate(L.deadline)} 🔒
Deposit: ${fmt(L.deposit)}. It books our flights.
Full refund if we don’t make it.
Lock your spot: ${pageUrl()}`;
}

function refundRule() {
  const L = state.lockin;
  return `🛡️ If ${L.threshold} people don’t lock in by ${fmtDate(L.deadline)}, everyone gets their ${fmt(L.deposit)} back automatically. You can’t spend the money until the trip is ON.`;
}

function refundRuleMember() {
  const L = state.lockin;
  return `🛡️ If fewer than ${L.threshold} people lock in by ${fmtDate(L.deadline)}, you get your ${fmt(L.deposit)} back automatically. Nobody, including Arjun, can spend it before the trip is ON.`;
}

function cancelledNote() {
  const n = lockedList().length;
  return `
    <section class="banner cancelled">
      <div class="banner-big">Trip cancelled</div>
      <p>${fmt(n * state.lockin.deposit)} refunded automatically to ${n} ${n === 1 ? 'person' : 'people'}. Nobody lost money.</p>
      <button type="button" class="btn secondary block" data-action="reset">Reset demo</button>
    </section>`;
}

/* ---------- Screen 1: Create trip and share (organiser) ---------- */

function screen1() {
  if (!isOrg()) return orgOnly('Creating the trip and sharing the link');
  const t = state.trip;
  const dis = state.created ? 'disabled' : '';
  let h = `
    <section class="card">
      <p class="muted">Whoever creates the trip becomes its organiser. You can add a co-organiser or hand the role over later.</p>
      <label class="field"><span>Trip name</span><input id="f-name" value="${esc(t.name)}" ${dis}></label>
      <label class="field"><span>Destination</span><input id="f-dest" value="${esc(t.destination)}" placeholder="Undecided is fine" ${dis}></label>
      <div class="grid2">
        <label class="field"><span>Travel window</span><input id="f-window" value="${esc(t.window)}" ${dis}></label>
        <label class="field"><span>Budget vote closes</span><input id="f-vote" value="${esc(t.voteCloses)}" ${dis}></label>
      </div>
      <div class="field">
        <span>Your WhatsApp group (8 people)</span>
        <div class="chips">${state.members.map(m => `<span class="chip">${esc(m.name)}${m.id === 'arjun' ? ' 👑' : ''}</span>`).join('')}</div>
      </div>
      ${state.created
        ? `<div class="success-line">✓ Trip created. You’re the organiser.</div>`
        : `<button type="button" class="btn primary block" data-action="create">Create trip and get link</button>`}
    </section>`;
  if (state.created) {
    h += sharePanel(voteMessage(), 'Your friends tap this link in WhatsApp. No app to install. See what they see:', 2);
  }
  return h;
}

/* ---------- Screen 2: Join and vote (member view) ---------- */

function voteStatus() {
  const v = voters().length;
  const pendingSims = SIM_ORDER.filter(id => SIM[id].vote != null && member(id).vote == null);
  const meNow = me();
  return `
    <section class="card">
      <div class="row-between"><h3>Who’s voted</h3><span class="pill">${v} of 8</span></div>
      <p class="muted small">Names are visible. Amounts never are.</p>
      <ul class="people">
        ${state.members.map(m => `
          <li>
            <span>${esc(m.name)}${m.id === 'arjun' ? ' 👑' : ''}${m === meNow ? '<span class="you">you</span>' : ''}</span>
            <span class="${m.vote != null ? 'st-ok' : 'st-wait'}">${m.vote != null ? '✓ Voted' : '⏳ Not yet'}</span>
          </li>`).join('')}
      </ul>
      ${pendingSims.length && !state.revealed ? simButton(`Simulate ${pendingSims.length} friends voting`, 'simVotes') : ''}
      ${!state.revealed ? `<button type="button" class="btn secondary block" data-action="go" data-screen="3">Go to the reveal</button>` : ''}
    </section>`;
}

function screen2() {
  if (!state.created) return waiting('The trip hasn’t been created yet', 'Arjun creates it and shares the link in step 1.', 1);
  const m = me();
  let h = tripCard();

  if (!m.joined) {
    return h + `
      <section class="card">
        <h2>Join the trip</h2>
        <p class="muted">No app to install. Just your name and number.</p>
        <label class="field"><span>Your name</span><input id="j-name" value="${esc(m.name)}" autocomplete="given-name"></label>
        <label class="field"><span>Phone number</span><input id="j-phone" inputmode="tel" placeholder="98765 43210" autocomplete="tel"></label>
        <button type="button" class="btn primary block" data-action="join">Join trip</button>
      </section>`;
  }

  if (state.revealed) {
    h += `
      <section class="card">
        <h2>Voting is closed</h2>
        <p>The group’s comfortable limit has been revealed.</p>
        <button type="button" class="btn primary block" data-action="go" data-screen="3">See the result</button>
      </section>`;
  } else if (m.vote == null || state.changingVote) {
    h += `
      <section class="card">
        <h2>What’s the most you’re comfortable spending?</h2>
        <p class="muted">Per person, all in: flights, stay and food.</p>
        <div class="budget-grid">
          ${BUDGETS.map(b => `<button type="button" class="budget ${state.pendingVote === b ? 'selected' : ''}" data-action="pickBudget" data-amount="${b}" aria-pressed="${state.pendingVote === b}">${fmtBudget(b)}</button>`).join('')}
        </div>
        <div class="privacy">🔒 Nobody sees your number, not even Arjun. Only the group’s comfortable limit is shown.</div>
        <button type="button" class="btn primary block" data-action="submitVote" ${state.pendingVote == null ? 'disabled' : ''}>Submit privately</button>
      </section>`;
  } else {
    h += `
      <section class="card">
        <h2>Your vote is in ✓</h2>
        <p>Only you can see this: <strong>${fmtBudget(m.vote)}</strong></p>
        <button type="button" class="btn ghost" data-action="changeVote">Change my vote</button>
      </section>`;
  }
  return h + voteStatus();
}

/* ---------- Screen 3: The reveal ---------- */

function screen3() {
  if (!state.created) return waiting('The trip hasn’t been created yet', 'Arjun creates it and shares the link in step 1.', 1);
  const v = voters().length;

  if (state.revealed) {
    const next = isOrg()
      ? `<button type="button" class="btn primary block" data-action="go" data-screen="4">Next: set up the lock-in</button>`
      : `<section class="card"><p>Arjun now plans the trip within this limit and opens the lock-in.</p>
           <button type="button" class="btn secondary block" data-action="go" data-screen="5">See the lock-in</button></section>`;
    return `
      <section class="card reveal-result ${state.flash === 'reveal' ? 'pop' : ''}">
        <p class="muted">Everyone’s comfortable up to</p>
        <div class="big-number">${fmt(state.ceiling)}</div>
        <p class="muted">per person</p>
        <p class="small">Based on ${v} of 8 votes. Individual votes stay private, even from Arjun.</p>
      </section>
      ${next}`;
  }

  let h = `
    <section class="card center">
      <p class="muted">${v} of 8 have voted. Voting closes ${esc(state.trip.voteCloses)}.</p>
      <div class="deck" id="deck" aria-label="${v} face-down votes">
        ${state.members.map(m => `<div class="pcard ${m.vote != null ? '' : 'empty'}">${m.vote != null ? '?' : ''}</div>`).join('')}
      </div>
      <p class="small muted">The reveal shows one number: the highest budget everyone is comfortable with. No card is ever turned over.</p>
    </section>`;

  if (isOrg()) {
    const notVoted = state.members.filter(m => m.vote == null);
    const can = v >= MIN_VOTES;
    h += orgPanel(`
      ${!can ? `<p class="warn">The reveal unlocks at ${MIN_VOTES} votes, so nobody’s number can be guessed.</p>` : ''}
      <button type="button" class="btn primary block" data-action="reveal" ${can ? '' : 'disabled'}>Reveal now</button>
      ${notVoted.length ? `<button type="button" class="btn secondary block" data-action="remindVoters">Remind the ${notVoted.length} who haven’t voted</button>
        <p class="small muted" style="margin-top:6px">Sent by TripLock as a 1:1 message, not from you.</p>` : ''}
    `);
    if (!can) h += `<button type="button" class="btn secondary block" data-action="go" data-screen="2">Back to voting</button>`;
  } else {
    h += `
      <section class="card">
        <p>Waiting for Arjun to reveal, or for voting to close.</p>
        <button type="button" class="btn secondary block" data-action="role" data-role="organiser">Switch to Arjun to reveal</button>
      </section>`;
  }
  return h;
}

/* ---------- Screen 4: Set up the lock-in (organiser) ---------- */

function screen4() {
  if (!isOrg()) return orgOnly('Setting the deposit, minimum group size and deadline');
  if (!state.revealed) return waiting('Do the budget reveal first', 'You set up the lock-in within the group’s comfortable limit.', 3);
  const L = state.lockin;

  if (L.started) {
    return `
      <section class="card">
        <h2>Lock-in is live ✓</h2>
        <dl class="summary">
          <div><dt>Estimated cost</dt><dd>${fmt(L.estimate)} per person</dd></div>
          <div><dt>Deposit</dt><dd>${fmt(L.deposit)} per person</dd></div>
          <div><dt>Minimum to go ahead</dt><dd>${L.threshold} of 8 people</dd></div>
          <div><dt>Deadline</dt><dd>${fmtDate(L.deadline)}</dd></div>
        </dl>
      </section>
      ${sharePanel(lockMessage(), 'Friends tap the link to lock their spot. See their side:', 5)}`;
  }

  const opts = [3, 4, 5, 6, 7, 8].map(n => `<option value="${n}" ${n === L.threshold ? 'selected' : ''}>${n} of 8 people</option>`).join('');
  return `
    <section class="card">
      <div class="limit-line">Group limit from the reveal: <strong>${fmt(state.ceiling)}</strong> per person</div>

      <label class="field"><span>Estimated trip cost per person (₹)</span>
        <input id="l-est" type="number" inputmode="numeric" min="0" step="500" value="${L.estimate}"></label>
      <p class="warn" id="est-warn" ${L.estimate > state.ceiling ? '' : 'hidden'}>This is above the group’s limit. Expect people to drop out.</p>

      <label class="field"><span>Deposit to lock a spot (₹)</span>
        <input id="l-dep" type="number" inputmode="numeric" min="0" step="500" value="${L.deposit}"></label>
      <p class="hint">Suggested: enough to book flights, about 22% of the trip. You can change it.</p>

      <div class="grid2">
        <label class="field"><span>Minimum people to go ahead</span><select id="l-thr">${opts}</select></label>
        <label class="field"><span>Lock-in deadline</span><input id="l-dl" type="date" value="${L.deadline}"></label>
      </div>

      <div class="field">
        <span>Decisions friends can captain</span>
        ${state.decisions.map(d => `
          <label class="check">
            <input type="checkbox" data-include="${d.id}" ${d.included ? 'checked' : ''}>
            <span><strong>${esc(d.title)}</strong><br><span class="muted small">${d.options.map(esc).join(', ')}</span></span>
          </label>`).join('')}
      </div>

      <div class="refund-box" id="refund-rule">${refundRule()}</div>
      <button type="button" class="btn primary block" data-action="startLockin">Start lock-in</button>
    </section>`;
}

/* ---------- Screen 5: Lock my spot (member view) ---------- */

function screen5() {
  const L = state.lockin;
  if (!L.started) {
    return waiting('The lock-in hasn’t started yet',
      isOrg() ? 'Set it up in step 4.' : 'Arjun opens it after the budget reveal.',
      isOrg() ? 4 : 3);
  }
  const m = me();
  let h = tripCard(`<div class="small"><strong>About ${fmt(L.estimate)} per person</strong></div>`);
  if (state.cancelled) return h + cancelledNote();

  h += `
    <section class="card">
      ${progressBar()}
      <p class="small muted" style="margin-top:8px">Closes ${fmtDate(L.deadline)}</p>
    </section>
    <section class="card">
      <h3>What you pay now</h3>
      <dl class="summary">
        <div><dt>Deposit today</dt><dd>${fmt(L.deposit)}</dd></div>
        <div><dt>Used for</dt><dd>Flights, booked only once the trip is ON</dd></div>
        <div><dt>The rest, later</dt><dd>${fmt(L.estimate - L.deposit)} in 2 instalments</dd></div>
      </dl>
      <div class="refund-box">${refundRuleMember()}</div>
    </section>`;

  if (!m.locked) {
    h += `
      <button type="button" class="btn primary block big" data-action="lockMe">Lock my spot for ${fmt(L.deposit)}</button>
      <p class="center small muted" style="margin-top:8px">Locking in before the deadline earns you ${TOKENS.lock} tokens.</p>`;
  } else {
    h += `
      <section class="card">
        <div class="success-line">✓ You’re locked in</div>
        <p style="margin-top:10px">You were number ${m.lockOrder} to lock in and earned ${TOKENS.lock} tokens.</p>
        <div class="btn-row">
          <button type="button" class="btn primary" data-action="go" data-screen="6">See the trip board</button>
          <button type="button" class="btn secondary" data-action="go" data-screen="7">Spend tokens</button>
        </div>
      </section>`;
  }
  return h;
}

/* ---------- Screen 6: Trip board (the core moment) ---------- */

function screen6() {
  const L = state.lockin;
  if (!L.started) {
    return waiting('The lock-in hasn’t started yet',
      isOrg() ? 'Set it up in step 4.' : 'Arjun opens it after the budget reveal.',
      isOrg() ? 4 : 3);
  }
  if (state.cancelled) return cancelledNote();

  const list = lockedList();
  const n = list.length;
  const m = me();
  const pending = state.members.filter(x => !x.locked);

  let banner;
  if (state.booked) {
    banner = `
      <section class="banner booked">
        <div class="banner-big">✈️ Flights booked</div>
        <p>Paid from the group pot: ${fmt(state.bookedAmount)}.</p>
        <p><strong>Arjun paid ₹0 from his own card and chased nobody.</strong></p>
      </section>`;
  } else if (isOn()) {
    banner = `
      <section class="banner on ${state.flash === 'on' ? 'pop' : ''}">
        <div class="banner-big">🎉 ${esc(destName())} is ON</div>
        <p>${n} of 8 locked in. ${fmt(n * L.deposit)} already collected.</p>
      </section>`;
  } else {
    const need = L.threshold - n;
    banner = `
      <section class="banner wait">
        <div class="banner-big">${need} more ${need === 1 ? 'person' : 'people'} needed</div>
        <p class="muted">by ${fmtDate(L.deadline)}, or everyone is refunded</p>
      </section>`;
  }

  const ordered = [...list, ...pending];
  const nextSim = SIM_ORDER.map(member).find(x => !x.locked);

  let h = banner + `
    <section class="card">
      ${progressBar()}
      <ul class="people">
        ${ordered.map(x => `
          <li>
            <span>${esc(x.name)}${x.id === 'arjun' ? ' 👑' : ''}${x === m ? '<span class="you">you</span>' : ''}</span>
            <span class="${x.locked ? 'st-ok' : 'st-wait'}">${x.locked ? `✓ Locked in, #${x.lockOrder}` : '⏳ Pending'}</span>
          </li>`).join('')}
      </ul>
      ${nextSim ? simButton(`Simulate ${nextSim.name} locking in`, 'simLock') : ''}
      ${!m.locked ? `<button type="button" class="btn primary block" data-action="go" data-screen="5">Lock my spot</button>` : ''}
    </section>`;

  if (isOrg()) {
    h += orgPanel(`
      <button type="button" class="btn primary block" data-action="book" ${isOn() && !state.booked ? '' : 'disabled'}>
        ${state.booked ? 'Flights booked ✓' : 'Book flights with group funds'}
      </button>
      ${!isOn() && !state.booked ? `<p class="small muted" style="margin-top:6px">Unlocks when ${L.threshold} people have locked in. Until then, nobody can spend the money.</p>` : ''}
      ${pending.length ? `
        <button type="button" class="btn secondary block" data-action="remindLock">Remind the ${pending.length} still pending</button>
        <p class="small muted" style="margin-top:6px">Sent by TripLock as a neutral 1:1 message, not from you.</p>` : ''}
      ${!state.booked ? `
        <div class="btn-row">
          <button type="button" class="btn ghost" data-action="extend">Extend deadline by 3 days</button>
          <button type="button" class="btn ghost danger" data-action="cancelTrip">Cancel and refund all</button>
        </div>` : ''}
    `);
  }
  return h;
}

/* ---------- Screen 7: Tokens and captain’s choice ---------- */

function taskRow(t, m) {
  let action;
  if (m.tasks[t.id]) {
    action = `<span class="st-ok">✓ Done</span>`;
  } else if (t.id === 'lock') {
    action = state.lockin.started && !state.cancelled
      ? `<button type="button" class="btn small secondary" data-action="go" data-screen="5">Lock in</button>`
      : `<span class="small muted">After lock-in opens</span>`;
  } else if (t.id === 'instalment') {
    action = m.locked
      ? `<button type="button" class="btn small secondary" data-action="payInstalment">Pay ${fmt(instalmentAmount())}</button>`
      : `<span class="small muted">After you lock in</span>`;
  } else if (t.id === 'passport') {
    action = `<button type="button" class="btn small secondary" data-action="passport">Add</button>`;
  } else if (t.id === 'visa') {
    action = `<button type="button" class="btn small secondary" data-action="task" data-task="visa">Mark sorted</button>`;
  } else {
    action = `<button type="button" class="btn small secondary" data-action="task" data-task="reply">Reply</button>`;
  }
  return `
    <li>
      <div><div>${t.label}</div><span class="token-chip">+${TOKENS[t.id]} tokens</span></div>
      ${action}
    </li>`;
}

function decisionCard(d, m) {
  const cap = d.captain ? member(d.captain) : null;
  const mine = d.captain === m.id;
  const myCount = state.decisions.filter(x => x.captain === m.id).length;
  const need = Math.max(MIN_BID, d.bid + 1);
  const sel = mine ? d.pick : state.selections[d.id];

  let status;
  if (d.closed) status = `<span class="pill closed">Closed: ${d.pick != null ? esc(d.options[d.pick]) : 'group decides'}</span>`;
  else if (cap) status = `<span class="pill">Captain: ${esc(cap.name)}${mine ? ' (you)' : ''}, ${d.bid} tokens</span>`;
  else status = `<span class="pill quiet">No captain yet</span>`;

  let body = '';
  if (!d.closed) {
    body += `<div class="options">
      ${d.options.map((o, i) => `
        <label class="opt ${cap && d.pick === i ? 'current-pick' : ''}">
          <input type="radio" name="opt-${d.id}" data-opt="${d.id}" value="${i}" ${sel === i ? 'checked' : ''}>
          <span>${esc(o)}${cap && d.pick === i ? ' <span class="small muted">(current pick)</span>' : ''}</span>
        </label>`).join('')}
    </div>`;
    if (mine) {
      body += `<p class="small st-ok">You’re the captain. Change your pick any time until Arjun closes this.</p>`;
    } else {
      const reason = myCount >= MAX_CAPTAIN
        ? `You already captain ${MAX_CAPTAIN} decisions.`
        : m.tokens < need ? `You need ${need} tokens and have ${m.tokens}.` : '';
      body += `<button type="button" class="btn small primary" data-action="captain" data-d="${d.id}" ${reason ? 'disabled' : ''}>Captain this for ${need} tokens</button>
        ${reason ? `<p class="small muted" style="margin-top:6px">${reason}</p>` : ''}`;
    }
    if (isOrg()) {
      body += `<div style="margin-top:8px"><button type="button" class="btn small ghost" data-action="closeDecision" data-d="${d.id}">👑 Close this decision</button></div>`;
    }
  }
  return `<div class="decision"><div class="row-between"><strong>${esc(d.title)}</strong>${status}</div>${body}</div>`;
}

function leaderboard() {
  const medals = ['🥇', '🥈', '🥉'];
  const top = state.members
    .filter(x => x.earned > 0)
    .sort((a, b) => b.earned - a.earned || (a.lockOrder ?? 99) - (b.lockOrder ?? 99))
    .slice(0, 3);
  const meNow = me();
  return `
    <section class="card">
      <h3>Leaderboard</h3>
      ${top.length ? `<ol class="board">
        ${top.map((x, i) => {
          const caps = state.decisions.filter(d => d.captain === x.id).map(d => esc(d.title));
          return `<li>
            <span>${medals[i]} ${esc(x.name)}${x === meNow ? '<span class="you">you</span>' : ''}</span>
            <span class="small">${x.earned} earned${caps.length ? `<br>captain of ${caps.join(', ')}` : ''}</span>
          </li>`;
        }).join('')}
      </ol>` : `<p class="muted small">No tokens earned yet. Lock in or finish a task to get on the board.</p>`}
      <p class="muted small" style="margin-top:8px">Only the top 3 are shown, so nobody is ranked last.</p>
    </section>`;
}

function taskTable() {
  const cols = [['lock', 'Locked'], ['passport', 'Passport'], ['visa', 'Visa'], ['instalment', '2nd pay']];
  return `
    <h4 style="margin-top:0">Task status by person</h4>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Name</th>${cols.map(c => `<th>${c[1]}</th>`).join('')}</tr></thead>
        <tbody>
          ${state.members.map(x => `<tr><td>${esc(x.name)}</td>${cols.map(c => `<td>${x.tasks[c[0]] ? '✅' : '·'}</td>`).join('')}</tr>`).join('')}
        </tbody>
      </table>
    </div>
    <p class="small muted" style="margin-top:6px">No more “has everyone done their visa?” in the group chat.</p>`;
}

function addDecisionForm() {
  return `
    <h4>Add a decision</h4>
    <label class="field"><span>Decision</span><input id="nd-title" placeholder="Day 2 breakfast spot"></label>
    <label class="field"><span>2 or 3 options, separated by commas</span><input id="nd-opts" placeholder="Cafe A, Cafe B, Cafe C"></label>
    <button type="button" class="btn secondary" data-action="addDecision">Add decision</button>`;
}

function screen7() {
  const m = me();
  const ds = state.decisions.filter(d => d.included);
  let h = `
    <section class="card token-head">
      <div><div class="small muted">Your tokens</div><div class="big-number">${m.tokens}</div></div>
      <p class="small">Earn tokens by doing what the group needs. Spend them to captain a trip decision, up to ${MAX_CAPTAIN} each. Tokens have no cash value.</p>
    </section>
    <section class="card">
      <h3>Earn tokens</h3>
      <ul class="tasks">${TASKS.map(t => taskRow(t, m)).join('')}</ul>
    </section>
    <section class="card">
      <h3>Captain’s choice</h3>
      <p class="muted small">Arjun chose the options, so every pick is safe. The highest bid gets the final call. If you’re outbid, your tokens come back.</p>
      ${ds.length ? ds.map(d => decisionCard(d, m)).join('') : '<p class="muted">No decisions are open.</p>'}
    </section>
    ${leaderboard()}`;
  if (isOrg()) h += orgPanel(taskTable() + addDecisionForm());
  return h;
}

const RENDER = { 1: screen1, 2: screen2, 3: screen3, 4: screen4, 5: screen5, 6: screen6, 7: screen7 };

/* ---------- Instruction strip ---------- */

function instruction() {
  const s = state.screen;
  const org = isOrg();
  const m = me();
  const L = state.lockin;
  const P = '👉 ';
  const orgOnlyMsg = P + 'Only the organiser sees this screen. Tap <b>Arjun</b> at the top.';

  switch (s) {
    case 1:
      if (!org) return orgOnlyMsg;
      return state.created
        ? P + 'Link ready. Try <b>Share on WhatsApp</b> if you like, then tap <b>Open the link as Riya</b> to see a friend’s side.'
        : P + 'You’re Arjun, the organiser. Check the trip details and tap <b>Create trip and get link</b>.';
    case 2:
      if (!state.created) return P + 'Start at step 1 as Arjun.';
      if (state.revealed) return P + 'Voting is closed. Go to the reveal.';
      if (!m.joined) return P + 'You’re Riya, opening Arjun’s link from WhatsApp. Tap <b>Join trip</b>.';
      if (m.vote == null || state.changingVote) return P + 'Pick the most you’re comfortable spending, then tap <b>Submit privately</b>.';
      if (org) return P + 'This is what friends see after tapping the link. Arjun has already voted. Switch to <b>Riya</b> to vote as a friend.';
      return P + 'Tap the purple <b>Simulate</b> button to fill in the other votes, then go to the reveal.';
    case 3:
      if (!state.created) return P + 'Start at step 1 as Arjun.';
      if (state.revealed) return P + 'The group’s real limit is out, and nobody had to say “I can’t afford that” in the chat.';
      if (voters().length < MIN_VOTES) return P + `At least ${MIN_VOTES} votes are needed. Go back to step 2 and simulate votes.`;
      return org
        ? P + 'Tap <b>Reveal now</b>. Only one number is shown, never anyone’s individual vote.'
        : P + 'Waiting for the reveal. Switch to <b>Arjun</b> to reveal now.';
    case 4:
      if (!org) return orgOnlyMsg;
      if (!state.revealed) return P + 'Do the reveal in step 3 first.';
      return L.started
        ? P + 'Share the lock-in message, then tap <b>Open the link as Riya</b>.'
        : P + 'Check the deposit, minimum people and deadline. The refund rule updates as you type. Then tap <b>Start lock-in</b>.';
    case 5:
      if (!L.started) return P + 'The lock-in opens after Arjun sets it up in step 4.';
      if (state.cancelled) return P + 'The trip was cancelled and everyone was refunded.';
      return m.locked
        ? P + 'You’re in. Open the trip board to watch the group fill up.'
        : P + 'Tap <b>Lock my spot</b> to pay your deposit. The payment is simulated.';
    case 6:
      if (!L.started) return P + 'The lock-in opens after Arjun sets it up in step 4.';
      if (state.cancelled) return P + 'Trip cancelled and everyone refunded. Tap <b>Reset demo</b> to start again.';
      if (state.booked) return P + 'Booked without fronting money or chasing anyone. See the perks in step 7.';
      if (isOn()) {
        return org
          ? P + 'The trip is ON. Tap <b>Book flights with group funds</b>.'
          : P + 'The trip is ON. Switch to <b>Arjun</b> to book with the group’s money.';
      }
      return P + 'Tap the purple <b>Simulate</b> button until the trip reaches its minimum. Watch the banner.';
    case 7:
      return P + 'Earn tokens by finishing trip tasks, then spend them to captain a decision.' + (org ? ' Organiser controls are at the bottom.' : '');
  }
  return '';
}

/* ---------- Render ---------- */

function stepDone(n) {
  switch (n) {
    case 1: return state.created;
    case 2: return me().vote != null;
    case 3: return state.revealed;
    case 4: return state.lockin.started;
    case 5: return me().locked;
    case 6: return isOn() || state.booked;
    default: return false;
  }
}

function render() {
  // Role switcher
  const arjun = member('arjun');
  const riya = member('riya');
  document.querySelectorAll('.seg [data-role]').forEach(b => {
    const active = b.dataset.role === state.role;
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', String(active));
    b.innerHTML = b.dataset.role === 'organiser'
      ? `👑 ${esc(arjun.name)}<small>organiser</small>`
      : `${esc(riya.name)}<small>friend</small>`;
  });

  // Step chips
  const steps = $('#steps');
  steps.innerHTML = SCREENS.map(s => `
    <button type="button" class="step ${s.n === state.screen ? 'current' : ''} ${stepDone(s.n) ? 'done' : ''}"
      data-action="go" data-screen="${s.n}" ${s.n === state.screen ? 'aria-current="step"' : ''}>
      <span class="num">${stepDone(s.n) && s.n !== state.screen ? '✓' : s.n}</span>${s.short}${s.org ? ' <span class="crown" title="Organiser only">👑</span>' : ''}
    </button>`).join('');
  const cur = steps.querySelector('.current');
  if (cur) steps.scrollLeft = cur.offsetLeft - (steps.clientWidth - cur.offsetWidth) / 2;

  // Instruction + screen
  $('#instruction').innerHTML = instruction();
  const meta = SCREENS[state.screen - 1];
  $('#screen').innerHTML = `
    <h1 class="screen-title"><span class="step-of">Step ${state.screen} of 7${meta.org ? ', organiser only' : ''}</span>${meta.title}</h1>
    ${RENDER[state.screen]()}`;

  // Bottom nav
  const s = state.screen;
  $('#bottomNav').innerHTML =
    (s > 1 ? `<button type="button" class="btn ghost" data-action="go" data-screen="${s - 1}">Back: ${SCREENS[s - 2].short}</button>` : '<span></span>') +
    (s < 7 ? `<button type="button" class="btn secondary" data-action="go" data-screen="${s + 1}">Next: ${SCREENS[s].short}</button>` : '<span></span>');

  state.flash = null;
}

function go(n) {
  state.screen = Math.min(7, Math.max(1, n));
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------- Actions ---------- */

function afterLock(wasOn, who) {
  if (!wasOn && isOn()) {
    state.flash = 'on';
    render();
    toast(`🎉 ${destName()} is ON! ${who} pushed it over the line.`);
  } else {
    render();
  }
}

const ACTIONS = {
  role(el) {
    state.role = el.dataset.role;
    state.changingVote = false;
    state.pendingVote = null;
    render();
    toast(`Now viewing as ${me().name}${isOrg() ? ', the organiser' : ', a friend'}`);
  },

  go(el) { go(Number(el.dataset.screen)); },

  asRiya(el) {
    state.role = 'member';
    state.changingVote = false;
    state.pendingVote = null;
    go(Number(el.dataset.screen));
    toast(`Now viewing as ${me().name}, a friend in the group`);
  },

  create() {
    if (!state.trip.name.trim()) { toast('Give the trip a name first'); return; }
    state.created = true;
    render();
    toast('Trip created. Now share the link.');
  },

  copy() { copyText(pageUrl()); },

  join() {
    const m = me();
    const input = $('#j-name');
    const name = input ? input.value.trim() : '';
    if (name) m.name = name;
    m.joined = true;
    render();
    toast(`Welcome, ${m.name}. Now vote privately.`);
  },

  pickBudget(el) {
    state.pendingVote = Number(el.dataset.amount);
    render();
  },

  submitVote() {
    if (state.pendingVote == null) return;
    me().vote = state.pendingVote;
    state.pendingVote = null;
    state.changingVote = false;
    render();
    toast('Vote submitted privately');
  },

  changeVote() {
    state.changingVote = true;
    state.pendingVote = me().vote;
    render();
  },

  simVotes() {
    let n = 0;
    SIM_ORDER.forEach(id => {
      const m = member(id);
      if (SIM[id].vote != null && m.vote == null) {
        m.vote = SIM[id].vote;
        m.joined = true;
        n++;
      }
    });
    render();
    toast(`${n} friends voted privately`);
  },

  remindVoters() {
    const names = state.members.filter(m => m.vote == null).map(m => m.name);
    toast(`TripLock reminded ${names.join(', ')}. Not from you.`);
  },

  reveal() {
    const deck = $('#deck');
    if (deck) deck.classList.add('gather');
    setTimeout(() => {
      state.revealed = true;
      state.ceiling = Math.min(...voters().map(m => m.vote));
      const L = state.lockin;
      L.estimate = Math.floor((state.ceiling * 0.95) / 1000) * 1000;
      L.deposit = Math.round((L.estimate * 0.22) / 500) * 500;
      state.flash = 'reveal';
      render();
      toast('Revealed. No individual vote was shown.');
    }, 650);
  },

  startLockin() {
    const L = state.lockin;
    if (!(L.estimate > 0)) { toast('Add an estimated trip cost'); return; }
    if (!(L.deposit > 0)) { toast('Set a deposit above ₹0'); return; }
    if (L.deposit > L.estimate) { toast('The deposit can’t be more than the trip cost'); return; }
    if (!L.deadline) { toast('Pick a deadline'); return; }
    L.started = true;
    render();
    toast('Lock-in is live. Share it on WhatsApp.');
  },

  lockMe() {
    const L = state.lockin;
    modal({
      title: 'Pay your deposit',
      body: `
        <div class="pay-amt">${fmt(L.deposit)}</div>
        <p class="center">To the group pot for <strong>${esc(state.trip.name)}</strong></p>
        <div class="refund-box">Held until the trip is ON. Refunded automatically if it isn’t.</div>
        <p class="small muted center" style="margin-top:10px">Simulated UPI payment. No real money moves.</p>`,
      actions: [
        { label: 'Cancel', cls: 'ghost' },
        {
          label: `Pay ${fmt(L.deposit)}`, cls: 'primary',
          fn: () => {
            const wasOn = isOn();
            lockMember(me());
            toast(`You’re locked in. +${TOKENS.lock} tokens`);
            afterLock(wasOn, me().name);
          }
        }
      ]
    });
  },

  simLock() {
    const next = SIM_ORDER.map(member).find(x => !x.locked);
    if (!next) return;
    const wasOn = isOn();
    lockMember(next);
    const s = SIM[next.id];
    s.tasks.forEach(t => earnTask(next, t));
    if (s.bid) {
      const d = state.decisions.find(x => x.id === s.bid.d);
      if (d && d.included && !d.closed && !d.captain && next.tokens >= s.bid.amount) {
        d.captain = next.id;
        d.bid = s.bid.amount;
        d.pick = s.bid.pick;
        next.tokens -= s.bid.amount;
      }
    }
    toast(`${next.name} locked in`);
    afterLock(wasOn, next.name);
  },

  remindLock() {
    const names = state.members.filter(m => !m.locked).map(m => m.name);
    toast(`TripLock reminded ${names.join(', ')}. Not from you.`);
  },

  book() {
    const n = lockedList().length;
    const amount = n * state.lockin.deposit;
    modal({
      title: `Book flights for ${n} people`,
      body: `
        <dl class="summary">
          <div><dt>Paid from the group pot</dt><dd>${fmt(amount)}</dd></div>
          <div><dt>Paid from your own card</dt><dd>₹0</dd></div>
        </dl>
        <p class="small muted" style="margin-top:10px">Simulated booking. In the real product this would use a travel partner.</p>`,
      actions: [
        { label: 'Not yet', cls: 'ghost' },
        {
          label: 'Book flights', cls: 'primary',
          fn: () => {
            state.booked = true;
            state.bookedAmount = amount;
            render();
            toast('Flights booked with group funds');
          }
        }
      ]
    });
  },

  extend() {
    const L = state.lockin;
    const d = new Date(L.deadline + 'T00:00:00');
    d.setDate(d.getDate() + 3);
    L.deadline = isoDate(d);
    render();
    toast(`Deadline moved to ${fmtDate(L.deadline)}. Everyone is told by TripLock.`);
  },

  cancelTrip() {
    const n = lockedList().length;
    modal({
      title: 'Cancel the trip?',
      body: `<p>All deposits (${fmt(n * state.lockin.deposit)}) go back to the ${n} ${n === 1 ? 'person' : 'people'} who paid, automatically.</p>`,
      actions: [
        { label: 'Keep the trip', cls: 'ghost' },
        { label: 'Cancel and refund', cls: 'primary', fn: () => { state.cancelled = true; render(); toast('Trip cancelled. Everyone refunded.'); } }
      ]
    });
  },

  passport() {
    modal({
      title: 'Add passport details',
      body: `
        <label class="field"><span>Name as on passport</span><input id="pp-name" value="${esc(me().name)}"></label>
        <label class="field"><span>Passport expiry</span><input id="pp-exp" type="month" value="2031-06"></label>
        <p class="small muted">Only Arjun sees that this is done, not the details. Demo only: nothing is stored.</p>`,
      actions: [
        { label: 'Cancel', cls: 'ghost' },
        {
          label: 'Save details', cls: 'primary',
          fn: () => {
            const v = $('#pp-name').value.trim();
            if (!v) { toast('Add your name as it appears on the passport'); return false; }
            earnTask(me(), 'passport');
            render();
            toast(`Passport details saved. +${TOKENS.passport} tokens`);
          }
        }
      ]
    });
  },

  task(el) {
    const id = el.dataset.task;
    if (earnTask(me(), id)) {
      render();
      toast(id === 'visa'
        ? `Visa marked as sorted. +${TOKENS.visa} tokens`
        : `Reply recorded. +${TOKENS.reply} token`);
    }
  },

  payInstalment() {
    const amt = instalmentAmount();
    modal({
      title: 'Pay 2nd instalment',
      body: `<div class="pay-amt">${fmt(amt)}</div><p class="small muted center">Simulated UPI payment. No real money moves.</p>`,
      actions: [
        { label: 'Cancel', cls: 'ghost' },
        {
          label: `Pay ${fmt(amt)}`, cls: 'primary',
          fn: () => { earnTask(me(), 'instalment'); render(); toast(`Instalment paid on time. +${TOKENS.instalment} tokens`); }
        }
      ]
    });
  },

  captain(el) {
    const d = state.decisions.find(x => x.id === el.dataset.d);
    const m = me();
    const sel = state.selections[d.id];
    if (sel == null) { toast('Pick an option first, then tap Captain'); return; }
    const need = Math.max(MIN_BID, d.bid + 1);
    if (m.tokens < need) { toast(`You need ${need} tokens`); return; }
    const prev = d.captain ? member(d.captain) : null;
    if (prev) prev.tokens += d.bid; // outbid captain gets their tokens back
    d.captain = m.id;
    d.bid = need;
    d.pick = sel;
    m.tokens -= need;
    render();
    toast(prev
      ? `You’re captain of ${d.title}. ${prev.name} got their tokens back.`
      : `You’re captain of ${d.title}`);
  },

  closeDecision(el) {
    const d = state.decisions.find(x => x.id === el.dataset.d);
    d.closed = true;
    render();
    toast(d.pick != null ? `${d.title}: ${d.options[d.pick]}. Shared with the group.` : `${d.title} closed. The group decides in WhatsApp.`);
  },

  addDecision() {
    const title = $('#nd-title').value.trim();
    const options = $('#nd-opts').value.split(',').map(s => s.trim()).filter(Boolean);
    if (!title) { toast('Name the decision'); return; }
    if (options.length < 2 || options.length > 3) { toast('Add 2 or 3 options, separated by commas'); return; }
    state.decisions.push({ id: 'd' + Date.now(), title, options, included: true, captain: null, bid: 0, pick: null, closed: false });
    render();
    toast('Decision added. Friends can now captain it.');
  },

  reset() {
    closeModal();
    state = initialState();
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    toast('Demo reset');
  }
};

/* ---------- Events ---------- */

document.addEventListener('click', e => {
  // Modal buttons
  const mb = e.target.closest('[data-modal]');
  if (mb) {
    const a = modalActions[Number(mb.dataset.modal)];
    if (a && a.fn && a.fn() === false) return;
    closeModal();
    return;
  }
  // Click on the dark backdrop closes the modal
  if (e.target.id === 'modal') { closeModal(); return; }

  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = ACTIONS[el.dataset.action];
  if (fn) fn(el, e);
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('#modal').hidden) closeModal();
});

// Typing in forms updates state without re-rendering (keeps focus in the field)
document.addEventListener('input', e => {
  const t = e.target;
  const L = state.lockin;
  switch (t.id) {
    case 'f-name': state.trip.name = t.value; return;
    case 'f-dest': state.trip.destination = t.value; return;
    case 'f-window': state.trip.window = t.value; return;
    case 'f-vote': state.trip.voteCloses = t.value; return;
    case 'l-est': {
      L.estimate = Number(t.value) || 0;
      const w = $('#est-warn');
      if (w) w.hidden = !(L.estimate > state.ceiling);
      break;
    }
    case 'l-dep': L.deposit = Number(t.value) || 0; break;
    case 'l-dl': L.deadline = t.value; break;
    default: return;
  }
  const r = $('#refund-rule');
  if (r) r.innerHTML = refundRule();
});

document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'l-thr') {
    state.lockin.threshold = Number(t.value);
    const r = $('#refund-rule');
    if (r) r.innerHTML = refundRule();
  }
  if (t.dataset.include) {
    const d = state.decisions.find(x => x.id === t.dataset.include);
    if (d) d.included = t.checked;
  }
  if (t.dataset.opt) {
    const d = state.decisions.find(x => x.id === t.dataset.opt);
    const idx = Number(t.value);
    state.selections[d.id] = idx;
    if (d.captain === me().id) {
      d.pick = idx;
      render();
      toast(`Pick updated: ${d.options[idx]}`);
    }
  }
});

/* ---------- Start ---------- */
render();
