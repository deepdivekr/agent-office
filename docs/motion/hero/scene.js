/* scene: agent-office — work scattered across AI apps comes together on one board.
   Stage: three client windows (codex, claude code, hermes) on top, the Office board in the middle,
   a messenger strip at the bottom.
   Shots: scattered (a job stops, nobody sees) | connect (jobs fly onto the board) |
          stopped (alert → detail → resume in the same session) | new work (intake → runs in Claude Code → result) |
          one screen (results delivered, counts). */
const SHOTS = SB.shots || [];
const SEQ = sequence(SHOTS.map(s => ({ name: s.name, sec: s.sec || 8, intro: s.intro || 0 })));
const CL = { y:192, h:252 }, WX = [60, 390, 720], WW = 300;
const BD = { x:60, y:476, w:960, h:620 }, AL = { x:60, y:1118, w:960, h:142 };
const LW = 218, LG = 16, LX0 = BD.x + 20, LANE_Y = BD.y + 192, CARD_Y0 = BD.y + 208, CARD_H = 88, CARD_STEP = 98;
const IN = { x:BD.x + 20, y:BD.y + 56, w:920 };
const DR = { x:BD.x + 482, y:BD.y + 176, w:458, h:292 };
const CLIENTS = ['codex', 'claude', 'hermes'];
const JOB = {}; (meta.jobs || []).forEach(j => JOB[j.id] = j);
const ARR = ['fx', 'cs', 'used', 'rel', 'paper', 'week'];   // arrival order on connect
const BASE = { fx:[3,0], paper:[3,1], cs:[1,0], used:[0,0], rel:[2,0], week:[2,1] };   // [lane, slot] once connected
const ARR0 = 0.9, ARR_STEP = 0.3, FLY = 0.55;
// stopped shot
const ST = { msg:0.5, cur0:1.5, click:2.3, drawIn:[2.3, 2.7], cur1:[2.9, 3.4], press:3.6, drawOut:[3.8, 4.1], toRun:[4.2, 4.8], toDone:[5.9, 6.5] };
// new work shot, seconds after the intro
const NW = { pill:0.15, slide:[0.45, 1.0], press:1.2, card:1.4, out:[1.6, 2.2], log:[2.3, 3.0, 3.7], back:[3.9, 4.4], toDone:[4.5, 5.0] };

function prepare() {}

const kindOf = i => (SHOTS[i] || {}).kind;
const iOf = k => SHOTS.findIndex(s => s.kind === k);
function lanePos(lane, slot) { return [LX0 + lane*(LW + LG), CARD_Y0 + slot*CARD_STEP]; }
function rowPos(client, idx) { const x = WX[CLIENTS.indexOf(client)]; return [x + 40, CL.y + 39 + 34 + idx*50]; }
function clientCol(c) { return colorOf((meta.clients[c] || {}).color || 'acc'); }

// ---------- state as a function of (shot, r) ----------
function connected(E) { return E.i > iOf('connect') || (E.i === iOf('connect') && E.r > E.I + 0.3); }
function boardA(E) { if (E.i < iOf('connect')) return 0; if (E.i === iOf('connect')) return ease(win(E.r, E.I + 0.3, E.I + 0.7));
  if (kindOf(E.i) === 'payoff') return 1 - ease(win(E.r, E.shot.sec - 0.7, E.shot.sec - 0.1)); return 1; }
function jobStatus(id, E) {
  const k = kindOf(E.i), r = E.r;
  if (id === 'used') {
    if (k === 'scattered') return r < 3.2 ? 'run' : 'fail';
    if (k === 'connect') return 'fail';
    if (k === 'stopped') return r < ST.toRun[0] ? 'fail' : r < ST.toDone[0] ? 'run' : 'ok';
    return 'ok';
  }
  if (id === 'price') { if (k !== 'newwork') return 'ok'; return r < E.I + NW.toDone[0] ? 'run' : 'ok'; }
  return { fx:'ok', paper:'ok', cs:'run', rel:'queue', week:'queue' }[id] || 'queue';
}
function priceExists(E) { const k = kindOf(E.i); return k === 'payoff' || (k === 'newwork' && E.r > E.I + NW.card); }
// Board card placement: { x, y, a, moving }
function cardAt(id, E) {
  const k = kindOf(E.i), r = E.r;
  if (id === 'price') {
    if (!priceExists(E)) return null;
    const a = lanePos(1, 1), b = lanePos(3, 3);
    if (k === 'payoff') return { x:b[0], y:b[1], a:1 };
    const q = ease(win(r, E.I + NW.toDone[0], E.I + NW.toDone[1]));
    return { x:lerp(a[0], b[0], q), y:lerp(a[1], b[1], q), a:appear(r, E.I + NW.card, 0), moving: q > 0 && q < 1 };
  }
  if (k === 'scattered') return null;
  if (k === 'connect') { const j = ARR.indexOf(id), at = E.I + ARR0 + j*ARR_STEP + FLY; if (r < at) return null;
    const p = lanePos(...BASE[id]); return { x:p[0], y:p[1], a:appear(r, at, 0), land: win(r, at, at + 0.4) }; }
  if (id === 'used' && k === 'stopped') {
    const n = lanePos(0, 0), m = lanePos(1, 1), d = lanePos(3, 2);
    const q1 = ease(win(r, ...ST.toRun)), q2 = ease(win(r, ...ST.toDone));
    const x = q2 > 0 ? lerp(m[0], d[0], q2) : lerp(n[0], m[0], q1), y = q2 > 0 ? lerp(m[1], d[1], q2) : lerp(n[1], m[1], q1);
    return { x, y, a:1, moving:(q1 > 0 && q1 < 1) || (q2 > 0 && q2 < 1) };
  }
  if (id === 'used') { const p = lanePos(3, 2); return { x:p[0], y:p[1], a:1 }; }
  const p = lanePos(...BASE[id]); return { x:p[0], y:p[1], a:1 };
}
function laneCount(lane, E) {
  const ids = ARR.concat(['price']); let n = 0;
  ids.forEach(id => { const c = cardAt(id, E); if (!c || c.a < 0.5 || c.moving) return;
    const l = Math.round((c.x - LX0) / (LW + LG)); if (l === lane) n++; });
  return n;
}

// ---------- parts ----------
function statusIcon(x, y, st, t, a = 1) {
  GA = a;
  if (st === 'ok') { dot(x, y, 6, C.ok); txt('✓', x, y + 3.5, { font:`600 9px ${M}`, color:C.bg, align:'center' }); }
  else if (st === 'fail') { dot(x, y, 6, C.human); txt('!', x, y + 3.5, { font:`600 9px ${M}`, color:C.bg, align:'center' }); }
  else if (st === 'run') spinner(x, y, t, 'acc', 6);
  else { ctx.beginPath(); ctx.arc(x, y, 5.5, 0, Math.PI*2); ctx.strokeStyle = C.faint; ctx.lineWidth = 1.5; ctx.globalAlpha = GA; ctx.stroke(); ctx.globalAlpha = 1; }
  GA = 1;
}
function clientWindow(c, E, t) {
  const x = WX[CLIENTS.indexOf(c)], cm = meta.clients[c], k = kindOf(E.i), r = E.r, L = meta.logs;
  windowChrome(x, CL.y, WW, CL.h, cm.title, { label: cm.label });
  fillR(x + WW - 26, CL.y + 13, 12, 12, 3, clientCol(c), 0.9);
  const jobs = (meta.jobs || []).filter(j => j.client === c && (j.id !== 'price' || priceExists(E)));
  jobs.forEach((j, idx) => {
    const [tx, ty] = rowPos(c, idx), st = jobStatus(j.id, E), a = j.id === 'price' ? appear(r, E.I + NW.out[1] - 0.1, 0) : 1;
    if (a <= 0) return;
    const fail = st === 'fail', fresh = j.id === 'used' && k === 'scattered' ? win(r, 3.2, 3.6) : 0;
    if (fail) fillR(x + 8, ty - 24, WW - 16, 50, 6, hexA(C.human, 0.10));
    if (fresh > 0 && fresh < 1) ripple(x + 22, ty - 5, fresh, C.human, 6, 26);
    statusIcon(x + 22, ty - 5, st, t, a);
    txt(fitText(j.title, `500 15px ${S}`, WW - 70), tx, ty + (1 - a)*6, { font:`500 15px ${S}`, color: fail ? C.human : C.text, alpha:a });
    txt(j.sched, tx, ty + 19, { font:`400 12px ${M}`, color:C.dim, alpha:a });
  });
  // last log line
  let log = '', col = C.dim;
  if (c === 'codex') log = L.codex;
  if (c === 'claude') {
    log = L.claude;
    if (k === 'newwork') { const s = E.I; log = r > s + NW.log[2] ? L.claudeWork[2] : r > s + NW.log[1] ? L.claudeWork[1] : r > s + NW.log[0] ? L.claudeWork[0] : L.claude; if (r > s + NW.log[0]) col = r > s + NW.log[2] ? C.ok : C.acc; }
    if (k === 'payoff') { log = L.claudeWork[2]; col = C.ok; }
  }
  if (c === 'hermes') {
    const st = jobStatus('used', E);
    log = st === 'fail' ? L.hermesFail : st === 'run' ? (k === 'stopped' ? L.hermesResume : L.hermesRun) : L.hermesOk;
    col = st === 'fail' ? C.human : st === 'run' && k === 'stopped' ? C.acc : st === 'ok' ? C.ok : C.dim;
  }
  ln(x + 1, CL.y + CL.h - 42.5, x + WW - 1, CL.y + CL.h - 42.5, C.line, 1);
  txt('›', x + 18, CL.y + CL.h - 17, { font:`600 13px ${M}`, color:C.faint });
  txt(fitText(log, `400 12px ${M}`, WW - 56), x + 34, CL.y + CL.h - 17, { font:`400 12px ${M}`, color:col });
}
function laneHeaders(E, a) {
  meta.lanes.forEach((name, i) => {
    const x = LX0 + i*(LW + LG), col = i === 0 ? C.human : i === 1 ? C.acc : i === 3 ? C.ok : C.dim, n = laneCount(i, E);
    txt(name, x, LANE_Y, { font:`600 14px ${S}`, color:col, alpha:a });
    txt(String(n), x + LW, LANE_Y, { font:`500 12px ${M}`, color:C.dim, align:'right', alpha:a });
    ln(x, LANE_Y + 8.5, x + LW, LANE_Y + 8.5, C.line2, 1, a);
  });
}
function card(id, c, E, t) {
  if (!c || c.a <= 0) return;
  const j = JOB[id], st = jobStatus(id, E), a = c.a, y = c.y + (1 - a)*6, x = c.x;
  const edge = st === 'fail' ? C.human : c.moving ? C.acc : C.line2;
  fillR(x, y, LW, CARD_H, 8, C.surf2, a);
  strokeR(x + .5, y + .5, LW - 1, CARD_H - 1, 8, edge, c.moving || st === 'fail' ? 1.5 : 1, a);
  if (c.land > 0 && c.land < 1) ripple(x + LW - 18, y + 21, c.land, st === 'fail' ? C.human : C.acc, 6, 24);
  txt(fitText(j.title, `600 15px ${S}`, LW - 46), x + 14, y + 27, { font:`600 15px ${S}`, color:C.text, alpha:a });
  statusIcon(x + LW - 18, y + 21, st, t, a);
  const cm = meta.clients[j.client], cf = `500 11px ${M}`, cw = mw(cm.chip, cf) + 14, col = clientCol(j.client);
  fillR(x + 14, y + 38, cw, 18, 9, hexA(col, 0.16*a)); txt(cm.chip, x + 21, y + 51, { font:cf, color:col, alpha:a });
  txt(fitText(j.sched, `400 11px ${M}`, LW - cw - 40), x + LW - 14, y + 51, { font:`400 11px ${M}`, color:C.dim, align:'right', alpha:a });
  const CS = meta.cardStatus, sy = y + 76, sf = `400 12px ${S}`;
  if (st === 'run') { const ph = (t*0.45 + (id.length % 5)*0.17) % 1; fillR(x + 14, sy - 6, LW - 28, 4, 2, C.line2, a); fillR(x + 14 + (LW - 28)*Math.max(0, ph - 0.35), sy - 6, (LW - 28)*Math.min(0.35, ph), 4, 2, C.acc, a); }
  else { const text = st === 'fail' ? CS.fail : st === 'ok' ? (j.result || CS.ok) : CS.queue, sc = st === 'fail' ? C.human : st === 'ok' ? C.ok : C.dim;
    txt(fitText(text, sf, LW - 28), x + 14, sy, { font:sf, color:sc, alpha:a }); }
}
function intake(E, t, a) {
  const I = meta.intake, k = kindOf(E.i), r = E.r, nw = k === 'newwork';
  const typeF = nw ? typeProgress(r, E.I) : 0, shown = I.prompt.slice(0, Math.floor(I.prompt.length*typeF));
  GA = a;
  fillR(IN.x, IN.y, 760, 40, 8, C.bg); strokeR(IN.x + .5, IN.y + .5, 759, 39, 8, nw && r < E.I + 0.2 ? C.acc : C.line2, 1);
  if (shown) txt(shown, IN.x + 14, IN.y + 26, { font:`400 15px ${S}`, color:C.text });
  else txt(I.placeholder, IN.x + 14, IN.y + 26, { font:`400 15px ${S}`, color:C.faint });
  if (nw && typeF < 1 && Math.floor(t*4) % 2 === 0) { ctx.fillStyle = C.acc; ctx.fillRect(IN.x + 16 + mw(shown, `400 15px ${S}`), IN.y + 11, 2, 19); }
  const pressed = nw ? band(r, E.I + NW.press, E.I + NW.press + 0.25, 0.08) : 0;
  fillR(IN.x + 776, IN.y, 144, 40, 8, C.acc, 0.85 + 0.15*pressed);
  txt(I.button, IN.x + 848, IN.y + 26, { font:`600 14px ${S}`, color:C.bg, align:'center' });
  // client pills
  const pick = nw ? (r > E.I + NW.pill ? 1 : 0) : (k === 'payoff' ? 1 : 0), py = IN.y + 56;
  let px = IN.x;
  I.pills.forEach((p, i) => { const on = i === pick, f = `${on ? 600 : 400} 13px ${S}`, w = mw(p, f) + 40;
    fillR(px, py, w, 30, 15, on ? hexA(C.acc, 0.14) : C.bg); strokeR(px + .5, py + .5, w - 1, 29, 15, on ? C.acc : C.line2, 1);
    dot(px + 16, py + 15, 5, on ? C.acc : C.line2); if (on) dot(px + 16, py + 15, 2.2, C.bg);
    txt(p, px + 28, py + 20, { font:f, color: on ? C.text : C.dim }); if (on && nw) { const q = win(r, E.I + NW.pill, E.I + NW.pill + 0.4); if (q < 1) ripple(px + 16, py + 15, q, C.acc, 5, 20); }
    px += w + 10; });
  // effort slider
  const sx = IN.x + 390, sw = 360, n = I.ticks.length - 1;
  txt(I.effortLabel, IN.x + 300, py + 20, { font:`400 12px ${S}`, color:C.dim });
  const target = nw ? lerp(0, I.pick, ease(win(r, E.I + NW.slide[0], E.I + NW.slide[1]))) : (k === 'payoff' ? I.pick : 0);
  ln(sx, py + 12, sx + sw, py + 12, C.line2, 4);
  ln(sx, py + 12, sx + sw*target/n, py + 12, C.acc, 4);
  dot(sx + sw*target/n, py + 12, 7, C.acc); dot(sx + sw*target/n, py + 12, 3, C.bg);
  I.ticks.forEach((tk, i) => { const on = Math.round(target) === i, al = i === 0 ? 'left' : i === n ? 'right' : 'center';
    txt(tk, sx + sw*i/n, py + 30, { font:`${on ? 600 : 400} 11px ${M}`, color: on ? C.text : C.dim, align:al }); });
  GA = 1;
}
function board(E, t) {
  const k = kindOf(E.i), r = E.r, a = boardA(E);
  windowChrome(BD.x, BD.y, BD.w, BD.h, meta.address, { label: meta.boardLabel, lock:true });
  // before connect: placeholder, then the typed command
  if (a < 1) {
    GA = 1 - a;
    if (k === 'connect') {
      const typeF = typeProgress(r, E.I), cmd = meta.command, shown = cmd.slice(0, Math.floor(cmd.length*typeF));
      txt('$', BD.x + 28, BD.y + 92, { font:`500 18px ${M}`, color:C.acc });
      txt(shown, BD.x + 52, BD.y + 92, { font:`500 18px ${M}`, color:C.text });
      if (typeF < 1 && Math.floor(t*4) % 2 === 0) { ctx.fillStyle = C.acc; ctx.fillRect(BD.x + 54 + mw(shown, `500 18px ${M}`), BD.y + 76, 10, 21); }
      const oa = win(r, E.I - 0.35, E.I - 0.1);
      if (oa > 0) txt(meta.commandOut, BD.x + 52, BD.y + 124, { font:`400 14px ${M}`, color:C.ok, alpha:oa });
    } else {
      txt(meta.unconnected[0], BD.x + BD.w/2, BD.y + 300, { font:`600 18px ${S}`, color:C.dim, align:'center' });
      txt(meta.unconnected[1], BD.x + BD.w/2, BD.y + 332, { font:`400 14px ${S}`, color:C.faint, align:'center' });
      if (k === 'scattered') { const q = win(r, 3.4, 3.9); if (q > 0) txt('?', BD.x + BD.w/2, BD.y + 252, { font:`600 34px ${M}`, color:C.human, align:'center', alpha:q }); }
    }
    GA = 1;
  }
  if (a <= 0) return;
  GA = a; intake(E, t, a); laneHeaders(E, a); GA = 1;
  ARR.concat(['price']).forEach(id => { const c = cardAt(id, E); if (c) { c.a *= a; card(id, c, E, t); } });
}
function drawer(E, t) {
  if (kindOf(E.i) !== 'stopped') return;
  const r = E.r, q = ease(win(r, ...ST.drawIn)) * (1 - ease(win(r, ...ST.drawOut)));
  if (q <= 0) return;
  const x = DR.x + (1 - q)*40, D = meta.drawer, j = JOB.used;
  GA = q;
  fillR(x - 4, DR.y - 4, DR.w + 8, DR.h + 8, 14, C.bg, 0.6);
  panel(x, DR.y, DR.w, DR.h);
  txt(j.title, x + 22, DR.y + 36, { font:`600 17px ${S}`, color:C.text });
  const cm = meta.clients[j.client], cf = `500 11px ${M}`, cw = mw(cm.chip, cf) + 14;
  fillR(x + DR.w - 22 - cw, DR.y + 21, cw, 18, 9, hexA(clientCol(j.client), 0.16)); txt(cm.chip, x + DR.w - 15 - cw, DR.y + 34, { font:cf, color:clientCol(j.client) });
  ln(x + 16, DR.y + 54.5, x + DR.w - 16, DR.y + 54.5, C.line, 1);
  D.rows.forEach(([lab, val], i) => { const y = DR.y + 90 + i*44, ra = appear(r, ST.drawIn[0] + 0.15, i);
    txt(lab, x + 22, y, { font:`400 12px ${M}`, color:C.dim, alpha:ra });
    wrapText(val, `500 14px ${S}`, DR.w - 120, 1).forEach(l => txt(l, x + 92, y, { font:`500 14px ${S}`, color: i === 0 ? C.human : C.text, alpha:ra })); });
  const pr = band(r, ST.press, ST.press + 0.25, 0.08), bw = mw(D.button, `600 14px ${S}`) + 36;
  fillR(x + DR.w - 22 - bw, DR.y + DR.h - 62, bw, 40, 8, C.acc, 0.85 + 0.15*pr);
  txt(D.button, x + DR.w - 22 - bw/2, DR.y + DR.h - 36, { font:`600 14px ${S}`, color:C.bg, align:'center' });
  GA = 1;
}
function strip(E, t) {
  const k = kindOf(E.i), r = E.r, S2 = meta.strip;
  panel(AL.x, AL.y, AL.w, AL.h);
  if (k === 'payoff') {
    const fo = ease(win(r, E.shot.sec - 0.7, E.shot.sec - 0.1));
    if (fo > 0) { txt(S2.title, AL.x + 22, AL.y + 32, { font:`600 15px ${S}`, color:C.text, alpha:fo }); txt(S2.empty, AL.x + 22, AL.y + 80, { font:`400 13px ${M}`, color:C.faint, alpha:fo }); }
    GA = 1 - fo;
    txt(S2.deliverTitle, AL.x + 22, AL.y + 32, { font:`600 15px ${S}`, color:C.text });
    let x = AL.x + 22;
    S2.deliver.forEach((d, i) => { const a = appear(r, 0.4, i*3); if (a <= 0) return; const w = pill(x, AL.y + 50 + (1 - a)*6, '✓ ' + d, 'ok', a); x += w + 10; });
    const ma = appear(r, 1.4, 0); if (ma > 0) txt(S2.delivered, AL.x + 22, AL.y + 102, { font:`400 13px ${M}`, color:C.dim, alpha:ma });
    S2.stats.forEach((s, i) => { const sx = AL.x + 600 + i*124, a = appear(r, 1.8, i*2); if (a <= 0) return;
      txt(countUp(0, s.n, win(r, 1.8 + i*0.14, 2.6 + i*0.14)), sx, AL.y + 72, { font:`600 40px ${M}`, color: i === 2 ? C.ok : C.acc, alpha:a });
      txt(s.label, sx, AL.y + 100, { font:`400 12px ${S}`, color:C.dim, alpha:a }); });
    GA = 1; return;
  }
  txt(S2.title, AL.x + 22, AL.y + 32, { font:`600 15px ${S}`, color:C.text });
  const show = k === 'stopped' ? appear(r, ST.msg, 0) : k === 'newwork' ? 1 : 0;
  if (show <= 0) { txt(S2.empty, AL.x + 22, AL.y + 80, { font:`400 13px ${M}`, color:C.faint }); return; }
  const y = AL.y + 58 + (1 - show)*6, dim = k === 'newwork' ? 0.5 : 1;
  GA = show*dim;
  const ff = `500 12px ${M}`, fw = mw(S2.from, ff) + 20;
  fillR(AL.x + 22, y, fw, 24, 12, hexA(C.teal, 0.16)); txt(S2.from, AL.x + 32, y + 16, { font:ff, color:C.teal });
  fillR(AL.x + 22 + fw + 12, y - 2, AL.w - 66 - fw, 54, 10, hexA(C.human, 0.10)); strokeR(AL.x + 22 + fw + 12.5, y - 1.5, AL.w - 67 - fw, 53, 10, C.human, 1, 0.6);
  dot(AL.x + 22 + fw + 32, y + 25, 5, C.human);
  txt(fitText(S2.alert, `500 15px ${S}`, AL.w - 130 - fw), AL.x + 22 + fw + 48, y + 30, { font:`500 15px ${S}`, color:C.text });
  GA = 1;
}
function travelers(E, t) {
  const k = kindOf(E.i), r = E.r;
  if (k === 'connect') ARR.forEach((id, j) => {
    const at = E.I + ARR0 + j*ARR_STEP, q = win(r, at, at + FLY); if (q <= 0 || q >= 1) return;
    const j0 = JOB[id], idx = (meta.jobs || []).filter(x => x.client === j0.client).indexOf(j0), [sx, sy] = rowPos(j0.client, idx), [lx, ly] = lanePos(...BASE[id]);
    const pts = [[sx + 120, sy], [sx + 120, BD.y + 20], [lx + LW/2, ly + CARD_H/2]], col = id === 'used' ? C.human : clientCol(j0.client);
    const [x, y] = along(pts, ease(q)); token(x, y, col);
  });
  if (k === 'stopped' && r > ST.msg - 0.1 && r < ST.msg + 0.5) { const [cx, cy] = lanePos(0, 0), q = ease(win(r, ST.msg - 0.1, ST.msg + 0.45));
    const [x, y] = along([[cx + LW/2, cy + CARD_H], [cx + LW/2, AL.y + 60]], q); token(x, y, 'human'); }
  if (k === 'newwork') {
    const [bx, by] = lanePos(1, 1), [wx, wy] = rowPos('claude', 2);
    const q1 = win(r, E.I + NW.out[0], E.I + NW.out[1]); if (q1 > 0 && q1 < 1) { const [x, y] = along([[bx + LW/2, by], [bx + LW/2, BD.y + 20], [wx + 100, wy]], ease(q1)); token(x, y, 'acc'); }
    const q2 = win(r, E.I + NW.back[0], E.I + NW.back[1]); if (q2 > 0 && q2 < 1) { const [x, y] = along([[wx + 100, wy], [bx + LW/2, BD.y + 20], [bx + LW/2, by]], ease(q2)); token(x, y, 'ok'); }
  }
}
function pointer(E) {
  if (kindOf(E.i) !== 'stopped') return;
  const r = E.r, [cx, cy] = lanePos(0, 0);
  const p0 = [AL.x + 360, AL.y + 70], p1 = [cx + 120, cy + 30], p2 = [DR.x + DR.w - 100, DR.y + DR.h - 44];
  let p;
  if (r < ST.cur0) return;
  if (r < ST.click) { const q = ease(win(r, ST.cur0, ST.click - 0.15)); p = [lerp(p0[0], p1[0], q), lerp(p0[1], p1[1], q)]; }
  else if (r < ST.cur1[0]) p = p1;
  else if (r < ST.drawOut[1] + 0.2) { const q = ease(win(r, ...ST.cur1)); p = [lerp(p1[0], p2[0], q), lerp(p1[1], p2[1], q)]; }
  else return;
  const ck = Math.max(win(r, ST.click - 0.05, ST.click + 0.35) * (r < ST.click + 0.35 ? 1 : 0), win(r, ST.press - 0.05, ST.press + 0.35) * (r > ST.press - 0.05 && r < ST.press + 0.35 ? 1 : 0));
  if (ck > 0) ripple(p[0], p[1], ck, C.acc, 4, 22);
  cursor(p[0], p[1]);
}
function runsHere(E) {
  if (kindOf(E.i) !== 'payoff') return;
  const a = ease(win(E.r, 2.8, 3.4)) * (1 - ease(win(E.r, E.shot.sec - 0.7, E.shot.sec - 0.1)));
  if (a <= 0) return;
  WX.forEach(x => ln(x + WW/2, CL.y + CL.h + 4, x + WW/2, BD.y - 4, C.acc, 1.5, a, [4, 5]));
  const f = `500 12px ${M}`, tw = mw(meta.runsHere, f) + 24, x = 540 - tw/2;
  fillR(x, CL.y + CL.h + 4, tw, 22, 11, C.bg, a); strokeR(x + .5, CL.y + CL.h + 4.5, tw - 1, 21, 11, C.acc, 1, a*0.7);
  txt(meta.runsHere, 540, CL.y + CL.h + 19, { font:f, color:C.acc, align:'center', alpha:a });
}

// ---------- frame ----------
function draw(t) {
  if (!SHOTS.length) return;
  const E = SEQ.at(t), k = kindOf(E.i), r = E.r, cam = cameraAmount(r, E.I);
  const focus = k === 'scattered' ? { x:390, y:CL.y, w:630, h:CL.h } : k === 'connect' ? { x:BD.x, y:BD.y, w:640, h:150 } : k === 'newwork' ? { x:BD.x, y:BD.y, w:800, h:170 } : { x:60, y:CL.y, w:960, h:CL.h };
  beginCamera(cam, focus);
  header(t, E.i);
  CLIENTS.forEach(c => clientWindow(c, E, t));
  const clientsOn = k === 'scattered' ? 1 : k === 'connect' ? band(r, E.I + ARR0 - 0.2, E.I + ARR0 + ARR.length*ARR_STEP + 0.3, 0.3)
    : k === 'stopped' ? band(r, ST.toRun[0], ST.toDone[1] + 0.3, 0.3) : k === 'newwork' ? band(r, E.I + NW.out[0], E.I + NW.back[1], 0.3) : 1;
  CLIENTS.forEach((c, i) => { const on = k === 'stopped' ? (c === 'hermes' ? clientsOn : 0) : k === 'newwork' ? (c === 'claude' ? clientsOn : 0) : clientsOn;
    spot(WX[i] - 6, CL.y - 6, WW + 12, CL.h + 12, on); });
  board(E, t);
  drawer(E, t);
  const boardOn = k === 'scattered' ? 0 : 1;
  spot(BD.x - 6, BD.y - 6, BD.w + 12, BD.h + 12, boardOn);
  strip(E, t);
  spot(AL.x - 6, AL.y - 6, AL.w + 12, AL.h + 12, k === 'stopped' ? band(r, ST.msg - 0.2, ST.cur0 + 0.6, 0.3) : k === 'payoff' ? 1 : 0);
  travelers(E, t);
  runsHere(E);
  pointer(E);
  footer();
  endCamera(cam, { x:focus.x - 4, y:focus.y - 4, w:focus.w + 8, h:focus.h + 8 });
}

boot({ clock: SEQ, count: SHOTS.length, prepare, draw, times: shotKeys(SEQ, [0.2, 0.45, 0.62, 0.8, 0.97]) });
