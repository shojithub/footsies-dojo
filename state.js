// Deterministic 60fps State Machine & Frame Data for 1D FOOTSIES + Anti-Air Dojo
// Fixed-point coordinates: Stage width = 0 to 1000 units, Ground Y = 0

export const INPUT_BITS = {
  LEFT:   1 << 0, // 0b000001
  RIGHT:  1 << 1, // 0b000010
  JUMP:   1 << 2, // 0b000100 (↑: Jump Attack)
  ATTACK: 1 << 3, // 0b001000 (A: Ground Poke / Mid Strike)
  ANTIAIR:1 << 4, // 0b010000 (B: Anti-Air Uppercut / Impact vs Jump)
  THROW:  1 << 5, // 0b100000 (C: Close Throw - beats Block)
};

export const FighterState = {
  IDLE: 0,
  WALK_FWD: 1,
  WALK_BACK: 2,   // Also auto-guards ground attacks & jump-ins!
  JUMP_ARC: 3,    // Jumping forward attack (38F total airtime, active at 26-34F)
  ATTACK: 4,      // Ground Poke (A): Startup 6F, Active 3F, Recovery 17F (Total 26F)
  ANTIAIR: 5,     // Anti-Air Upper (B): Startup 5F, Active 8F, Recovery 24F (Total 37F) - Air Invulnerable!
  THROW: 6,       // Throw (C): Startup 4F, Active 2F, Recovery 18F (Total 24F)
  BLOCK_STUN: 7,
  HIT_STUN: 8,
  KNOCKDOWN: 9,
};

export const FRAME_DATA = {
  STAGE_MIN: 60,
  STAGE_MAX: 940,
  PUSHBOX_RADIUS: 32,
  WALK_FWD_SPEED: 4.2,
  WALK_BACK_SPEED: 3.0,

  // Jump Attack (↑) - 40 Frames total so human can react (~20-32F window)
  JUMP: {
    TOTAL: 40,
    ACTIVE_START: 25,
    ACTIVE_END: 34,
    LAND_RECOVERY: 4,
    VX: 5.2,
    PEAK_Y: 165,
    DAMAGE: 30,
    HIT_STUN: 20,
    BLOCK_STUN: 12,
  },

  // A: Ground Poke (Attack) - Beats Throw & Approaching opponent, loses to Jump-in & Whiff punish
  ATTACK: {
    STARTUP: 6,
    ACTIVE: 3,
    RECOVERY: 17, // 17F of yellow vulnerable recovery on whiff
    TOTAL: 26,
    REACH: 165,
    EXTENDED_HURTBOX: 145, // Leaves limb out during recovery for whiff punishing!
    DAMAGE: 22,
    HIT_STUN: 16,
    BLOCK_STUN: 11, // -3F on block
    PUSHBACK: 38,
  },

  // B: Anti-Air / Reversal (Anti-Air) - 100% invincible vs Air attacks, huge whiff recovery vs Ground
  ANTIAIR: {
    STARTUP: 4,
    ACTIVE: 10,
    RECOVERY: 24,
    TOTAL: 38,
    REACH_X: 115,
    REACH_Y: 190,
    DAMAGE: 35,
    HIT_STUN: 28,
    BLOCK_STUN: 8, // Very unsafe (-16F) if blocked on ground!
  },

  // C: Throw - Beats Guard, loses to Attack (A) or Jump (↑)
  THROW: {
    STARTUP: 4,
    ACTIVE: 2,
    RECOVERY: 18,
    TOTAL: 24,
    REACH: 76, // Must be very close!
    DAMAGE: 25,
    HIT_STUN: 24,
  }
};

export function createInitialPlayer(x, facing) {
  return {
    x,
    y: 0,
    vx: 0,
    hp: 100,
    facing, // 1 = right, -1 = left
    state: FighterState.IDLE,
    stateFrame: 0,
    stunFrames: 0,
    hasHit: false,
    whiffed: false,
    jumpStartFrame: -1, // Tracks when jump began to measure Anti-Air reaction time!
    prevInput: 0,
  };
}

export function createInitialGameState() {
  return {
    frame: 0,
    hitstopFrames: 0,
    roundTimer: 60 * 60,
    p1: createInitialPlayer(320, 1),
    p2: createInitialPlayer(680, -1),
    lastEvent: null, // Coaching feedback event triggered on this frame
  };
}

export function cloneState(state) {
  return {
    frame: state.frame,
    hitstopFrames: state.hitstopFrames,
    roundTimer: state.roundTimer,
    p1: { ...state.p1 },
    p2: { ...state.p2 },
    lastEvent: state.lastEvent ? { ...state.lastEvent } : null,
  };
}

// Compute current Hurtbox (Blue or Yellow) and Hitbox (Red/Purple/Green) for rendering & collision
export function getBoxes(player) {
  const f = player.facing;
  const x = player.x;
  const y = player.y;

  // Base hurtbox
  let hurtbox = {
    x1: x - 28,
    x2: x + 28,
    y1: y,
    y2: y + 110,
    type: 'NORMAL', // BLUE
  };

  let hitbox = null;

  if (player.state === FighterState.ATTACK) {
    const sf = player.stateFrame;
    const fd = FRAME_DATA.ATTACK;
    if (sf >= fd.STARTUP && sf < fd.STARTUP + fd.ACTIVE) {
      hitbox = {
        x1: f === 1 ? x : x - fd.REACH,
        x2: f === 1 ? x + fd.REACH : x,
        y1: 25,
        y2: 85,
        type: 'STRIKE', // RED
      };
    } else if (sf >= fd.STARTUP + fd.ACTIVE) {
      // Whiff / Recovery extends yellow vulnerable hurtbox forward!
      hurtbox.x1 = f === 1 ? x - 28 : x - fd.EXTENDED_HURTBOX;
      hurtbox.x2 = f === 1 ? x + fd.EXTENDED_HURTBOX : x + 28;
      hurtbox.type = 'WHIFF_PUNISHABLE'; // YELLOW
    }
  } else if (player.state === FighterState.ANTIAIR) {
    const sf = player.stateFrame;
    const fd = FRAME_DATA.ANTIAIR;
    if (sf >= fd.STARTUP && sf < fd.STARTUP + fd.ACTIVE) {
      hitbox = {
        x1: f === 1 ? x - 15 : x - fd.REACH_X,
        x2: f === 1 ? x + fd.REACH_X : x + 15,
        y1: 20,
        y2: fd.REACH_Y,
        type: 'ANTIAIR', // PURPLE
      };
      hurtbox.type = 'AIR_INVINCIBLE'; // PURPLE HURTBOX
    } else if (sf >= fd.STARTUP + fd.ACTIVE) {
      hurtbox.type = 'WHIFF_PUNISHABLE'; // YELLOW
    }
  } else if (player.state === FighterState.THROW) {
    const sf = player.stateFrame;
    const fd = FRAME_DATA.THROW;
    if (sf >= fd.STARTUP && sf < fd.STARTUP + fd.ACTIVE) {
      hitbox = {
        x1: f === 1 ? x : x - fd.REACH,
        x2: f === 1 ? x + fd.REACH : x,
        y1: 10,
        y2: 95,
        type: 'THROW', // GREEN
      };
    } else if (sf >= fd.STARTUP + fd.ACTIVE) {
      hurtbox.type = 'WHIFF_PUNISHABLE'; // YELLOW
    }
  } else if (player.state === FighterState.JUMP_ARC) {
    const sf = player.stateFrame;
    const fd = FRAME_DATA.JUMP;
    if (sf >= fd.ACTIVE_START && sf <= fd.ACTIVE_END) {
      hitbox = {
        x1: f === 1 ? x - 10 : x - 85,
        x2: f === 1 ? x + 85 : x + 10,
        y1: y - 10,
        y2: y + 60,
        type: 'JUMP_ATTACK', // RED
      };
    }
  } else if (player.state === FighterState.HIT_STUN || player.state === FighterState.KNOCKDOWN) {
    hurtbox.type = 'DAMAGED';
  }

  return { hurtbox, hitbox };
}

function boxesOverlap(a, b) {
  if (!a || !b) return false;
  return a.x1 <= b.x2 && a.x2 >= b.x1 && a.y1 <= b.y2 && a.y2 >= b.y1;
}

// Pure deterministic 1-frame step function
export function stepGameState(state, p1Input, p2Input) {
  state.frame++;
  state.lastEvent = null;

  if (state.hitstopFrames > 0) {
    state.hitstopFrames--;
    state.p1.prevInput = p1Input;
    state.p2.prevInput = p2Input;
    return state;
  }

  if (state.roundTimer > 0) state.roundTimer--;

  updatePlayerState(state.p1, p1Input, state.p2, state.frame, 1, state);
  updatePlayerState(state.p2, p2Input, state.p1, state.frame, 2, state);

  // Move & Physics
  applyPhysics(state.p1);
  applyPhysics(state.p2);

  // Pushbox collision (prevent overlapping on ground)
  const dist = Math.abs(state.p1.x - state.p2.x);
  const minDist = FRAME_DATA.PUSHBOX_RADIUS * 2;
  if (dist < minDist && state.p1.y < 60 && state.p2.y < 60) {
    const overlap = (minDist - dist) / 2;
    if (state.p1.x <= state.p2.x) {
      state.p1.x -= overlap;
      state.p2.x += overlap;
    } else {
      state.p1.x += overlap;
      state.p2.x -= overlap;
    }
  }

  // Clamp stage bounds
  state.p1.x = Math.max(FRAME_DATA.STAGE_MIN, Math.min(FRAME_DATA.STAGE_MAX, state.p1.x));
  state.p2.x = Math.max(FRAME_DATA.STAGE_MIN, Math.min(FRAME_DATA.STAGE_MAX, state.p2.x));

  // Update facing when on ground and idle/walking
  if (state.p1.y === 0 && canTurn(state.p1)) {
    state.p1.facing = state.p1.x <= state.p2.x ? 1 : -1;
  }
  if (state.p2.y === 0 && canTurn(state.p2)) {
    state.p2.facing = state.p2.x < state.p1.x ? 1 : -1;
  }

  // Resolve Hitboxes vs Hurtboxes
  resolveCombat(state, p1Input, p2Input);

  state.p1.prevInput = p1Input;
  state.p2.prevInput = p2Input;
  return state;
}

function canTurn(p) {
  return p.state === FighterState.IDLE || p.state === FighterState.WALK_FWD || p.state === FighterState.WALK_BACK;
}

function isActionable(p) {
  return p.state === FighterState.IDLE || p.state === FighterState.WALK_FWD || p.state === FighterState.WALK_BACK;
}

function updatePlayerState(p, input, opponent, currentFrame, playerIndex, state) {
  p.stateFrame++;

  // Handle Stun / Knockdown recovery
  if (p.state === FighterState.BLOCK_STUN || p.state === FighterState.HIT_STUN || p.state === FighterState.KNOCKDOWN) {
    p.stunFrames--;
    p.vx *= 0.82;
    if (p.stunFrames <= 0) {
      p.state = FighterState.IDLE;
      p.stateFrame = 0;
      p.vx = 0;
      p.y = 0;
    }
    return;
  }

  // Handle active attack/jump completions
  if (p.state === FighterState.ATTACK) {
    if (p.stateFrame >= FRAME_DATA.ATTACK.TOTAL) {
      p.state = FighterState.IDLE;
      p.stateFrame = 0;
    }
    return;
  }
  if (p.state === FighterState.ANTIAIR) {
    if (p.stateFrame >= FRAME_DATA.ANTIAIR.TOTAL) {
      p.state = FighterState.IDLE;
      p.stateFrame = 0;
    }
    return;
  }
  if (p.state === FighterState.THROW) {
    if (p.stateFrame >= FRAME_DATA.THROW.TOTAL) {
      p.state = FighterState.IDLE;
      p.stateFrame = 0;
    }
    return;
  }
  if (p.state === FighterState.JUMP_ARC) {
    const t = p.stateFrame / FRAME_DATA.JUMP.TOTAL;
    if (t >= 1.0) {
      p.y = 0;
      p.vx = 0;
      p.state = FighterState.IDLE;
      p.stateFrame = 0;
    } else {
      // Parabolic jump arc
      p.y = Math.round(4 * FRAME_DATA.JUMP.PEAK_Y * t * (1 - t));
    }
    return;
  }

  // Actionable Ground States
  if (isActionable(p)) {
    const pressedAttack = (input & INPUT_BITS.ATTACK) && !(p.prevInput & INPUT_BITS.ATTACK);
    const pressedAntiAir = (input & INPUT_BITS.ANTIAIR) && !(p.prevInput & INPUT_BITS.ANTIAIR);
    const pressedThrow = (input & INPUT_BITS.THROW) && !(p.prevInput & INPUT_BITS.THROW);
    const pressedJump = (input & INPUT_BITS.JUMP);

    if (pressedAntiAir) {
      p.state = FighterState.ANTIAIR;
      p.stateFrame = 0;
      p.vx = 0;
      p.hasHit = false;
      state.lastEvent = { type: 'WHIFF_SOUND' };
      return;
    }
    if (pressedThrow) {
      p.state = FighterState.THROW;
      p.stateFrame = 0;
      p.vx = 0;
      p.hasHit = false;
      state.lastEvent = { type: 'WHIFF_SOUND' };
      return;
    }
    if (pressedAttack) {
      p.state = FighterState.ATTACK;
      p.stateFrame = 0;
      p.vx = 0;
      p.hasHit = false;
      state.lastEvent = { type: 'WHIFF_SOUND' };
      return;
    }
    if (pressedJump) {
      p.state = FighterState.JUMP_ARC;
      p.stateFrame = 0;
      p.vx = p.facing * FRAME_DATA.JUMP.VX;
      p.hasHit = false;
      p.jumpStartFrame = currentFrame;
      state.lastEvent = { type: 'JUMP_START', byPlayer: playerIndex, frame: currentFrame };
      return;
    }

    // Horizontal Movement
    const holdLeft = Boolean(input & INPUT_BITS.LEFT);
    const holdRight = Boolean(input & INPUT_BITS.RIGHT);

    if (holdLeft && !holdRight) {
      const movingForward = p.facing === -1;
      p.state = movingForward ? FighterState.WALK_FWD : FighterState.WALK_BACK;
      p.vx = movingForward ? -FRAME_DATA.WALK_FWD_SPEED : -FRAME_DATA.WALK_BACK_SPEED;
    } else if (holdRight && !holdLeft) {
      const movingForward = p.facing === 1;
      p.state = movingForward ? FighterState.WALK_FWD : FighterState.WALK_BACK;
      p.vx = movingForward ? FRAME_DATA.WALK_FWD_SPEED : FRAME_DATA.WALK_BACK_SPEED;
    } else {
      p.state = FighterState.IDLE;
      p.vx = 0;
    }
  }
}

function applyPhysics(p) {
  p.x += p.vx;
}

function isHoldingBack(player, input) {
  if (player.facing === 1) return Boolean(input & INPUT_BITS.LEFT);
  return Boolean(input & INPUT_BITS.RIGHT);
}

function resolveCombat(state, p1Input, p2Input) {
  const b1 = getBoxes(state.p1);
  const b2 = getBoxes(state.p2);

  const p1HitP2 = !state.p1.hasHit && boxesOverlap(b1.hitbox, b2.hurtbox);
  const p2HitP1 = !state.p2.hasHit && boxesOverlap(b2.hitbox, b1.hurtbox);

  // Special rule: Anti-Air (B) is completely invulnerable to JUMP_ATTACK!
  const p1AntiAirBeatJump =
    state.p1.state === FighterState.ANTIAIR &&
    state.p2.state === FighterState.JUMP_ARC &&
    (p1HitP2 || Math.abs(state.p1.x - state.p2.x) < 120);

  const p2AntiAirBeatJump =
    state.p2.state === FighterState.ANTIAIR &&
    state.p1.state === FighterState.JUMP_ARC &&
    (p2HitP1 || Math.abs(state.p1.x - state.p2.x) < 120);

  if (p1AntiAirBeatJump && p1HitP2) {
    state.p1.hasHit = true;
    const reactionFrames = state.frame - state.p2.jumpStartFrame - state.p1.stateFrame;
    applyHitOutcome(state, state.p1, state.p2, b1.hitbox.type, false, 'P1', reactionFrames);
    return;
  }

  if (p2AntiAirBeatJump && p2HitP1) {
    state.p2.hasHit = true;
    const reactionFrames = state.frame - state.p1.jumpStartFrame - state.p2.stateFrame;
    applyHitOutcome(state, state.p2, state.p1, b2.hitbox.type, false, 'P2', reactionFrames);
    return;
  }

  if (p1HitP2) {
    state.p1.hasHit = true;
    const canBlock = isActionable(state.p2) && isHoldingBack(state.p2, p2Input) && b1.hitbox.type !== 'THROW';
    applyHitOutcome(state, state.p1, state.p2, b1.hitbox.type, canBlock, 'P1', 0);
  }

  if (p2HitP1) {
    state.p2.hasHit = true;
    const canBlock = isActionable(state.p1) && isHoldingBack(state.p1, p1Input) && b2.hitbox.type !== 'THROW';
    applyHitOutcome(state, state.p2, state.p1, b2.hitbox.type, canBlock, 'P2', 0);
  }
}

function applyHitOutcome(state, attacker, defender, attackType, isBlocked, attackerLabel, reactionFrames) {
  const defenderWasWhiffing =
    defender.state === FighterState.ATTACK && defender.stateFrame >= FRAME_DATA.ATTACK.STARTUP + FRAME_DATA.ATTACK.ACTIVE ||
    defender.state === FighterState.ANTIAIR && defender.stateFrame >= FRAME_DATA.ANTIAIR.STARTUP + FRAME_DATA.ANTIAIR.ACTIVE ||
    defender.state === FighterState.THROW && defender.stateFrame >= FRAME_DATA.THROW.STARTUP + FRAME_DATA.THROW.ACTIVE;

  const defenderWasStartup =
    (defender.state === FighterState.THROW && defender.stateFrame < FRAME_DATA.THROW.STARTUP) ||
    (defender.state === FighterState.ATTACK && defender.stateFrame < FRAME_DATA.ATTACK.STARTUP);

  if (isBlocked) {
    state.hitstopFrames = 8;
    defender.state = FighterState.BLOCK_STUN;
    defender.stateFrame = 0;
    defender.stunFrames = attackType === 'JUMP_ATTACK' ? FRAME_DATA.JUMP.BLOCK_STUN : FRAME_DATA.ATTACK.BLOCK_STUN;
    defender.vx = attacker.facing * 6.5;

    state.lastEvent = {
      type: 'BLOCKED',
      attacker: attackerLabel,
      attackType,
      title: attackerLabel === 'P1' ? '相手にガードされた！' : 'ナイスガード！（←入力）',
      reason:
        attackType === 'ANTIAIR'
          ? '【重要】地上の相手に「B：対空」をガードされると大きな隙（黄色）を晒します！反撃のチャンス！'
          : attackType === 'JUMP_ATTACK'
          ? '飛び込みをガードしました！ただしガード後は相手が先に動ける（密着じゃんけん発生）ので注意。'
          : '地上牽制（A）を後ろ歩きでしっかりガード！距離が離れて仕切り直しになります。',
      category: 'GUARD',
    };
    return;
  }

  // Clean Hit!
  state.hitstopFrames = attackType === 'ANTIAIR' || defenderWasWhiffing ? 14 : 10;

  let dmg = 20;
  let stun = 16;
  let knockback = 7.0;
  let title = '';
  let reason = '';
  let category = 'HIT';

  if (attackType === 'ANTIAIR') {
    dmg = FRAME_DATA.ANTIAIR.DAMAGE;
    stun = FRAME_DATA.ANTIAIR.HIT_STUN;
    knockback = 10.5;
    defender.y = 0;
    if (defender.state === FighterState.JUMP_ARC) {
      const rxF = Math.max(10, Math.min(39, reactionFrames));
      const rxMs = Math.round(rxF * 16.67);
      title = attackerLabel === 'P1' ? `⚡ 対空大成功！！ (反応: ${rxF}F / ${rxMs}ms)` : '💥 飛び込みを対空で落とされた！';
      reason =
        attackerLabel === 'P1'
          ? `素晴らしい意識配分です！相手のジャンプを見てから「B：対空」で無敵撃墜しました！`
          : `相手が地上を見て待っている時に安易に飛ぶと、「B：対空」で100%落とされてしまいます。`;
      category = 'ANTIAIR_SUCCESS';
    } else {
      title = '対空アッパーヒット！';
      reason = '無敵の「B：対空」がヒットしました。';
    }
  } else if (attackType === 'THROW') {
    dmg = FRAME_DATA.THROW.DAMAGE;
    stun = FRAME_DATA.THROW.HIT_STUN;
    knockback = 11.0;
    title = attackerLabel === 'P1' ? '🟩 投げ成功！（ガード崩し！）' : '💥 投げられた！（ガード負け）';
    reason =
      attackerLabel === 'P1'
        ? '【じゃんけん勝利：投げ ＞ ガード】固まっている相手には密着からの「C：投げ」が100%勝てます！'
        : '【じゃんけん敗北：ガード ＜ 投げ】密着でガード（←）を固めすぎると「C：投げ」に負けます。打撃（A）か後ろ歩きで拒否しましょう！';
    category = 'THROW_SUCCESS';
  } else if (attackType === 'JUMP_ATTACK') {
    dmg = FRAME_DATA.JUMP.DAMAGE;
    stun = FRAME_DATA.JUMP.HIT_STUN;
    knockback = 6.0;
    title = attackerLabel === 'P1' ? '🦅 飛び込みヒット！' : '💥 飛び込みを通された！（対空ミス）';
    reason =
      attackerLabel === 'P1'
        ? '相手の牽制（A）を上から飛び越えてジャンプ攻撃を決めました！'
        : defender.state === FighterState.ATTACK
        ? '【被弾理由】地上の「A：牽制」を空振りしている最中に飛ばれました！牽制の振りすぎはジャンプの餌食になります。'
        : '【対空課題】相手がジャンプした瞬間に「B：対空」ボタンを押せば、無敵で一方的に撃ち落とせます！';
    category = 'JUMP_HIT';
  } else if (attackType === 'STRIKE') {
    dmg = FRAME_DATA.ATTACK.DAMAGE;
    stun = FRAME_DATA.ATTACK.HIT_STUN;
    knockback = 6.5;

    if (defenderWasWhiffing) {
      dmg = Math.round(dmg * 1.25);
      title = attackerLabel === 'P1' ? '🔥 差し返し（パニッシュ）成功！！' : '💥 空振りの隙（黄色）を殴られた！';
      reason =
        attackerLabel === 'P1'
          ? '【中距離の極意】相手の技を後ろ歩きでかわし、黄色い「空振り硬直」にAボタンを突き刺しました！'
          : '【被弾理由】技を空振りすると「黄色い無防備な腕」が長く残ります。届く距離を見極めて振りましょう！';
      category = 'WHIFF_PUNISH';
    } else if (defender.state === FighterState.THROW) {
      title = attackerLabel === 'P1' ? '🟥 打撃で「投げ」を潰した！' : '💥 投げにいって打撃（A）に潰された！';
      reason =
        attackerLabel === 'P1'
          ? '【じゃんけん勝利：打撃 ＞ 投げ】投げようと近づく相手を、リーチの長い「A：打撃」で迎え撃ちました！'
          : '【じゃんけん敗北：投げ ＜ 打撃】相手が打撃（A）を振っているところに投げに行くと、リーチ差で負けます！';
      category = 'STRIKE_BEATS_THROW';
    } else if (defenderWasStartup) {
      title = attackerLabel === 'P1' ? '⚡ カウンターヒット！' : '💥 技の出掛かりを潰された！';
      reason = '相手より先に攻撃判定が到達し、出掛かりを潰しました（発生勝ち）。';
    } else {
      title = attackerLabel === 'P1' ? '🟥 牽制（A：打撃）ヒット！' : '💥 牽制（A：打撃）を食らった！';
      reason =
        attackerLabel === 'P1'
          ? '前進してくる相手の無防備な足元に、先端の「A：打撃」を当てました！'
          : '前進中（→）や棒立ちは無防備です。相手のAボタンが届く間合い（赤ライン）では後ろ（←）でガードを意識しましょう！';
    }
  }

  defender.hp = Math.max(0, defender.hp - dmg);
  defender.state = attackType === 'ANTIAIR' || attackType === 'THROW' ? FighterState.KNOCKDOWN : FighterState.HIT_STUN;
  defender.stateFrame = 0;
  defender.stunFrames = stun;
  defender.vx = attacker.facing * knockback;

  state.lastEvent = {
    type: 'HIT',
    attacker: attackerLabel,
    attackType,
    isHeavy: attackType === 'ANTIAIR' || defenderWasWhiffing || attackType === 'THROW',
    title,
    reason,
    category,
    reactionFrames,
  };
}
