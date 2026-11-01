import { INPUT_BITS, createInitialGameState } from './state.js';
import { P2PRollbackEngine } from './network.js';
import { DOJO_MODES, DojoTrainerAI } from './dojo_ai.js';
import { DojoRenderer } from './renderer.js';
import { sound } from './audio.js';

const canvas = document.getElementById('gameCanvas');
const renderer = new DojoRenderer(canvas);
let gameState = createInitialGameState();
const netEngine = new P2PRollbackEngine(gameState);
const trainerAI = new DojoTrainerAI();

let startOnRightSide = false;

// Training Statistics
const stats = {
  antiAirSuccess: 0,
  antiAirMissed: 0,
  bestReactionFrames: null,
  rpsWins: 0,
  whiffPunishes: 0,
};

let coachingPopup = {
  title: '📱 スマホ格ゲー反復道場へようこそ！',
  reason: '下の大型ボタンで操作！2台で対戦する時は右上の【📡 P2P対戦】をタップ！',
  color: '#38bdf8',
  timer: 320,
};

// Keyboard & Multi-Touch Virtual Pad State
const keysDown = new Set();
let virtualInputMask = 0;

window.addEventListener('keydown', (e) => {
  if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'Space', 'KeyA', 'KeyD', 'KeyW', 'KeyJ', 'KeyK', 'KeyL', 'KeyZ', 'KeyX', 'KeyC', 'KeyV'].includes(e.code)) {
    e.preventDefault();
  }
  if (e.code === 'KeyV' && !e.repeat) {
    setBlindfoldMode(!renderer.stealthSelfMode);
  }
  keysDown.add(e.code);
});

window.addEventListener('keyup', (e) => {
  keysDown.delete(e.code);
});

// Multi-Touch & Mouse Handler for Mobile Thumb Pad
const padButtons = Array.from(document.querySelectorAll('.pad-btn[data-bit]'));
let mouseDownBit = 0;

function updateMultiTouchState(e) {
  e.preventDefault();
  sound.init();
  let newMask = 0;
  const activeBtns = new Set();

  for (let i = 0; i < e.touches.length; i++) {
    const t = e.touches[i];
    const el = document.elementFromPoint(t.clientX, t.clientY);
    const btn = el ? el.closest('.pad-btn[data-bit]') : null;
    if (btn) {
      const bit = Number(btn.getAttribute('data-bit'));
      newMask |= bit;
      activeBtns.add(btn);
    }
  }

  if ((newMask & ~virtualInputMask) && navigator.vibrate) {
    navigator.vibrate(8);
  }

  virtualInputMask = newMask;
  padButtons.forEach((b) => {
    b.classList.toggle('pressed', activeBtns.has(b));
  });
}

const touchPadArea = document.getElementById('touchPadArea');
touchPadArea.addEventListener('touchstart', updateMultiTouchState, { passive: false });
touchPadArea.addEventListener('touchmove', updateMultiTouchState, { passive: false });
touchPadArea.addEventListener('touchend', updateMultiTouchState, { passive: false });
touchPadArea.addEventListener('touchcancel', updateMultiTouchState, { passive: false });

padButtons.forEach((btn) => {
  const bit = Number(btn.getAttribute('data-bit'));
  btn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    sound.init();
    mouseDownBit = bit;
    virtualInputMask |= bit;
    btn.classList.add('pressed');
  });
  const clearMouse = () => {
    if (mouseDownBit === bit) {
      virtualInputMask &= ~bit;
      mouseDownBit = 0;
    }
    btn.classList.remove('pressed');
  };
  btn.addEventListener('mouseup', clearMouse);
  btn.addEventListener('mouseleave', clearMouse);
});

function getLocalInput() {
  let mask = virtualInputMask;
  if (keysDown.has('ArrowLeft') || keysDown.has('KeyA')) mask |= INPUT_BITS.LEFT;
  if (keysDown.has('ArrowRight') || keysDown.has('KeyD')) mask |= INPUT_BITS.RIGHT;
  if (keysDown.has('ArrowUp') || keysDown.has('KeyW') || keysDown.has('Space')) mask |= INPUT_BITS.JUMP;

  if (keysDown.has('KeyJ') || keysDown.has('KeyZ')) mask |= INPUT_BITS.ATTACK;
  if (keysDown.has('KeyK') || keysDown.has('KeyX')) mask |= INPUT_BITS.ANTIAIR;
  if (keysDown.has('KeyL') || keysDown.has('KeyC')) mask |= INPUT_BITS.THROW;

  return mask;
}

// ===========================================================================
// WebRTC P2P Matchmaking UI & Handlers (Android <-> iPad)
// ===========================================================================
const p2pModal = document.getElementById('p2pModal');
const btnOpenP2P = document.getElementById('btnOpenP2P');
const btnCloseP2P = document.getElementById('btnCloseP2P');
const btnHostRoom = document.getElementById('btnHostRoom');
const btnJoinRoom = document.getElementById('btnJoinRoom');
const btnDisconnectP2P = document.getElementById('btnDisconnectP2P');
const hostRoomCodeEl = document.getElementById('hostRoomCode');
const joinCodeInput = document.getElementById('joinCodeInput');
const p2pStatusMsg = document.getElementById('p2pStatusMsg');

btnOpenP2P.addEventListener('click', () => {
  p2pModal.classList.add('open');
});
btnCloseP2P.addEventListener('click', () => {
  p2pModal.classList.remove('open');
});

function onP2PStatusUpdate(info) {
  p2pStatusMsg.textContent = info.message || '';
  if (info.roomCode && netEngine.localPlayerNum === 1) {
    hostRoomCodeEl.textContent = info.roomCode;
  }
  if (info.state === 'CONNECTED') {
    sound.playSuccessChime();
    btnOpenP2P.textContent = `🟢 P2P対戦中(${info.playerNum}P)`;
    btnOpenP2P.classList.add('online');
    btnDisconnectP2P.style.display = 'block';
    setTimeout(() => {
      p2pModal.classList.remove('open');
    }, 650);
  } else if (info.state === 'DISCONNECTED') {
    btnOpenP2P.textContent = '📡 P2P対戦';
    btnOpenP2P.classList.remove('online');
    btnDisconnectP2P.style.display = 'none';
    renderer.localPlayerNum = 1;
    updateRoleLabels();
    coachingPopup = {
      title: '🔌 P2P対戦が終了しました',
      reason: 'CPU道場モードに戻りました。',
      color: '#f87171',
      timer: 200,
    };
  }
}

netEngine.onMatchStart = (myPlayerNum) => {
  renderer.localPlayerNum = myPlayerNum;
  startOnRightSide = false;
  gameState = createInitialGameState();
  netEngine.resetBuffers(gameState);
  renderer.smoothBlindX = myPlayerNum === 2 ? gameState.p2.x : gameState.p1.x;
  renderer.camX = 500;
  updateRoleLabels();

  coachingPopup = {
    title: `⚡ P2Pオンライン対戦スタート！あなたは【${myPlayerNum}P (${myPlayerNum === 1 ? '左側' : '右側'})】です！`,
    reason: '目隠しボタン(🙈)を押すと自分のキャラだけを隠して相手キャラに集中できます！',
    color: '#4ade80',
    timer: 260,
  };
};

function updateRoleLabels() {
  const p1Lbl = document.getElementById('p1RoleLabel');
  const p2Lbl = document.getElementById('p2RoleLabel');
  if (netEngine.isOnline) {
    if (netEngine.localPlayerNum === 1) {
      p1Lbl.textContent = '1P(自)';
      p2Lbl.textContent = '2P(相手)';
    } else {
      p1Lbl.textContent = '1P(相手)';
      p2Lbl.textContent = '2P(自)';
    }
  } else {
    p1Lbl.textContent = '1P(自)';
    p2Lbl.textContent = '2P(CPU)';
  }
}

btnHostRoom.addEventListener('click', () => {
  sound.init();
  netEngine.hostRoom(onP2PStatusUpdate);
});

btnJoinRoom.addEventListener('click', () => {
  sound.init();
  netEngine.joinRoom(joinCodeInput.value, onP2PStatusUpdate);
});

btnDisconnectP2P.addEventListener('click', () => {
  netEngine.disconnect();
  onP2PStatusUpdate({ state: 'DISCONNECTED', message: 'P2P接続を切断しました' });
});

// Bind Drill Mode Selector Buttons
document.querySelectorAll('[data-drill]').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (netEngine.isOnline) {
      coachingPopup = {
        title: '📡 現在はP2Pオンライン対戦中です',
        reason: 'CPU道場に戻る場合は右上の「🟢 P2P対戦中」から切断してください。',
        color: '#facc15',
        timer: 180,
      };
      return;
    }
    document.querySelectorAll('[data-drill]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const mode = btn.getAttribute('data-drill');
    trainerAI.setMode(mode);
    resetPositions();
  });
});

// Tap Route Badge to cycle P2P Route simulation in Offline mode
const routeOrder = ['IPV6_DIRECT', 'PEER_RELAY', 'OPEN_NAT64'];
let routeIdx = 0;
document.getElementById('routeBadge').addEventListener('click', () => {
  if (netEngine.isOnline) return;
  routeIdx = (routeIdx + 1) % routeOrder.length;
  const route = routeOrder[routeIdx];
  netEngine.setRoutePreset(route);
  updateRouteBadge(route);
});

// Toggle Training Assists
function setBlindfoldMode(enabled) {
  renderer.stealthSelfMode = enabled;
  const btn = document.getElementById('btnToggleBlindfold');
  if (btn) {
    btn.textContent = enabled ? '🙈 目隠し:ON' : '🙈 目隠し:OFF';
    btn.className = enabled ? 'tool-btn blind-on' : 'tool-btn blind-off';
  }
  coachingPopup = {
    title: enabled ? '🙈 自キャラ目隠しカーテン ON！' : '👀 自キャラ目隠し OFF',
    reason: enabled
      ? '自分の操作キャラ側をカーテンで隠しました！相手キャラだけを見て間合いを掴んでみましょう！'
      : '自キャラの表示を元に戻しました。',
    color: enabled ? '#facc15' : '#38bdf8',
    timer: 200,
  };
}

document.getElementById('btnToggleBlindfold').addEventListener('click', () => {
  setBlindfoldMode(!renderer.stealthSelfMode);
});
document.getElementById('toggleEyeReticle').addEventListener('change', (e) => {
  renderer.eyeTrackerGuide = e.target.checked;
});
document.getElementById('toggleJumpAlert').addEventListener('change', (e) => {
  renderer.showJumpFlash = e.target.checked;
});
document.getElementById('btnResetPos').addEventListener('click', () => {
  if (netEngine.isOnline && netEngine.conn && netEngine.conn.open) {
    netEngine.conn.send({ t: 'RESET_SYNC' });
    netEngine.onMatchStart(netEngine.localPlayerNum);
    return;
  }
  resetPositions();
});
document.getElementById('btnSwapSide').addEventListener('click', () => {
  if (netEngine.isOnline) return;
  startOnRightSide = !startOnRightSide;
  resetPositions();
  coachingPopup = {
    title: startOnRightSide ? '🔄 右側（2P側）スタートに切替！' : '🔄 左側（1P側）スタートに切替！',
    reason: startOnRightSide
      ? '自キャラが右側（右移動がガード、左移動が前進）になります。目隠しも右側を覆います！'
      : '自キャラが左側（左移動がガード、右移動が前進）になります。',
    color: '#38bdf8',
    timer: 200,
  };
});

// Tap Canvas when Match is Over to trigger instant Rematch!
canvas.addEventListener('pointerdown', () => {
  if (gameState.roundState === 'MATCH_OVER') {
    triggerInstantRematch();
  }
});

function triggerInstantRematch() {
  sound.init();
  sound.playSuccessChime();
  if (netEngine.isOnline && netEngine.conn && netEngine.conn.open) {
    netEngine.conn.send({ t: 'RESET_SYNC' });
    netEngine.onMatchStart(netEngine.localPlayerNum);
    return;
  }
  resetPositions();
}

function applyModePositions(state) {
  const mode = trainerAI.mode;
  if (!netEngine.isOnline) {
    if (mode === DOJO_MODES.RPS_DRILL) {
      state.p1.x = 450;
      state.p2.x = 525;
    } else if (mode === DOJO_MODES.WHIFF_DRILL) {
      state.p1.x = 400;
      state.p2.x = 580;
    }
    if (startOnRightSide) {
      const tmpX = state.p1.x;
      state.p1.x = 1000 - tmpX;
      state.p2.x = 1000 - state.p2.x;
      state.p1.facing = -1;
      state.p2.facing = 1;
    }
  }
}

function resetPositions() {
  gameState = createInitialGameState(0, 0, 1);
  applyModePositions(gameState);
  renderer.localPlayerNum = netEngine.isOnline ? netEngine.localPlayerNum : 1;
  const selfP = renderer.localPlayerNum === 2 ? gameState.p2 : gameState.p1;
  renderer.smoothBlindX = selfP.x;
  renderer.camX = (gameState.p1.x + gameState.p2.x) / 2;
  netEngine.resetBuffers(gameState);
}

function updateRouteBadge(route) {
  const badge = document.getElementById('routeBadge');
  if (route === 'IPV6_DIRECT') {
    badge.textContent = netEngine.isOnline ? '🟢 P2P Direct' : '🟢 IPv6直通';
    badge.className = 'route-badge direct';
  } else if (route === 'PEER_RELAY') {
    badge.textContent = '🟡 PeerRelay';
    badge.className = 'route-badge relay';
  } else {
    badge.textContent = '🔵 NAT64(RB実演)';
    badge.className = 'route-badge nat64';
  }
}

function handleCoachingEvents(ev) {
  if (!ev) return;
  const myLabel = netEngine.isOnline && netEngine.localPlayerNum === 2 ? 'P2' : 'P1';
  const enemyPlayerIdx = netEngine.isOnline && netEngine.localPlayerNum === 2 ? 1 : 2;

  if (ev.type === 'WHIFF_SOUND') {
    sound.playWhiff();
    return;
  }
  if (ev.type === 'JUMP_START') {
    sound.playJump();
    if (ev.byPlayer === enemyPlayerIdx && renderer.showJumpFlash) {
      sound.playJumpAlert();
    }
    return;
  }
  if (ev.type === 'ROUND_OVER') {
    sound.playHit(true);
    return;
  }
  if (ev.type === 'NEXT_ROUND') {
    applyModePositions(gameState);
    sound.playJumpAlert();
    coachingPopup = {
      title: `🔔 ROUND ${ev.roundNum} FIGHT!!`,
      reason: '2ラウンド先取で勝利です！相手の動きをよく見て反応しましょう！',
      color: '#38bdf8',
      timer: 110,
    };
    return;
  }
  if (ev.type === 'MATCH_OVER') {
    if (ev.winner === myLabel) {
      sound.playSuccessChime();
    } else {
      sound.playHit(true);
    }
    matchEndCooldown = 35; // Prevent accidental button mash from skipping result screen immediately
    return;
  }
  if (ev.type === 'BLOCKED') {
    sound.playBlock();
    coachingPopup = {
      title: ev.title,
      reason: ev.reason,
      color: '#60a5fa',
      timer: 180,
    };
    return;
  }
  if (ev.type === 'HIT') {
    const iAmAttacker = ev.attacker === myLabel;
    if (ev.category === 'ANTIAIR_SUCCESS' && iAmAttacker) {
      sound.playSuccessChime();
      stats.antiAirSuccess++;
      const rxF = Math.max(10, Math.min(39, ev.reactionFrames));
      if (stats.bestReactionFrames === null || rxF < stats.bestReactionFrames) {
        stats.bestReactionFrames = rxF;
      }
      coachingPopup = {
        title: `⚡ 対空大成功！！ (反応: ${rxF}F / ${Math.round(rxF * 16.67)}ms)`,
        reason: ev.reason,
        color: '#c084fc',
        timer: 210,
      };
    } else {
      sound.playHit(ev.isHeavy);
      if (ev.category === 'JUMP_HIT' && !iAmAttacker) {
        stats.antiAirMissed++;
      }
      if ((ev.category === 'THROW_SUCCESS' || ev.category === 'STRIKE_BEATS_THROW') && iAmAttacker) {
        stats.rpsWins++;
      }
      if (ev.category === 'WHIFF_PUNISH' && iAmAttacker) {
        stats.whiffPunishes++;
        sound.playSuccessChime();
      }
      coachingPopup = {
        title: ev.title,
        reason: ev.reason,
        color: iAmAttacker ? '#4ade80' : '#f87171',
        timer: 210,
      };
    }
    updateStatsUI();
  }
}

function updateStatsUI() {
  document.getElementById('statAntiAir').textContent = `${stats.antiAirSuccess}`;
  document.getElementById('statBestRx').textContent = stats.bestReactionFrames
    ? `${stats.bestReactionFrames}F`
    : '--';
  document.getElementById('statRpsWins').textContent = `${stats.rpsWins}`;
  document.getElementById('statWhiff').textContent = `${stats.whiffPunishes}`;
}

// Fixed 60fps Game Loop with accumulator
let lastTime = performance.now();
const STEP_MS = 1000 / 60;
let accumulator = 0;
let matchEndCooldown = 0;

function starsText(wins) {
  if (wins >= 2) return '★★';
  if (wins === 1) return '★☆';
  return '☆☆';
}

function gameLoop(now) {
  const delta = Math.min(100, now - lastTime);
  lastTime = now;
  accumulator += delta;

  while (accumulator >= STEP_MS) {
    const localIn = getLocalInput();

    // If Match is over, pressing Attack (A), Anti-Air (B), or Throw (C) after brief cooldown triggers instant Rematch!
    if (gameState.roundState === 'MATCH_OVER') {
      if (matchEndCooldown > 0) {
        matchEndCooldown--;
      } else if (localIn & (INPUT_BITS.ATTACK | INPUT_BITS.ANTIAIR | INPUT_BITS.THROW)) {
        triggerInstantRematch();
        break;
      }
    }

    const cpuIn = netEngine.isOnline ? 0 : trainerAI.getInput(gameState);

    gameState = netEngine.stepWithRollback(gameState, localIn, cpuIn);
    renderer.recordFrameHistory(gameState);

    if (gameState.lastEvent) {
      handleCoachingEvents(gameState.lastEvent);
    }

    if (coachingPopup.timer > 0) coachingPopup.timer--;
    accumulator -= STEP_MS;
  }

  document.getElementById('p1HpFill').style.width = `${gameState.p1.hp}%`;
  document.getElementById('p2HpFill').style.width = `${gameState.p2.hp}%`;
  document.getElementById('p1Stars').textContent = starsText(gameState.p1Wins);
  document.getElementById('p2Stars').textContent = starsText(gameState.p2Wins);
  document.getElementById('roundTimerBox').textContent = String(Math.ceil(gameState.roundTimer / 60));

  document.getElementById('dojoHintText').textContent = netEngine.isOnline
    ? `⚡ P2Pオンライン通信対戦中！（ルーム: ${netEngine.roomCode} / あなたは ${netEngine.localPlayerNum}P）`
    : trainerAI.currentHint;

  const metrics = netEngine.getMetrics();
  updateRouteBadge(metrics.route);
  document.getElementById('metricRtt').textContent = `${metrics.rttMs}ms`;
  document.getElementById('metricRollback').textContent = `${metrics.rollbackFrames}F`;

  renderer.render(gameState, netEngine, coachingPopup);
  requestAnimationFrame(gameLoop);
}

requestAnimationFrame(gameLoop);
