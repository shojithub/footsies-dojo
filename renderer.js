// Ultra-Low-Latency Procedural Canvas Renderer (Stickman + Hitboxes + Range Guides + 60F Meter)
import { FighterState, FRAME_DATA, getBoxes } from './state.js?v=11';

export class DojoRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    // Note: Avoid { desynchronized: true, alpha: false } because it causes colorful GPU tile corruption/glitches on Android Chrome!
    this.ctx = canvas.getContext('2d');
    this.width = canvas.width;
    this.height = canvas.height;
    this.groundY = 335;
    this.camX = 500; // Smooth camera center for mobile zoom clarity

    // 60-Frame History Ring Buffer for Frame Meter
    this.p1FrameHistory = new Array(60).fill('IDLE');
    this.p2FrameHistory = new Array(60).fill('IDLE');
    this.showRangeGuide = true;
    this.showJumpFlash = true;
    this.eyeTrackerGuide = true;  // Shows calm focal point & floor color bridge
    this.stealthSelfMode = false; // 🙈 Blindfold / Curtain over Local Self so player cannot look at Self!
    this.localPlayerNum = 1;      // 1 = P1 is Self, 2 = P2 is Self (in Online P2P Guest mode!)
    this.shakeMag = 0;            // Lightweight damped screen shake magnitude on hit/block
    this.matchOverlayInfo = {
      p1SetWins: 0,
      p2SetWins: 0,
      p1Streak: 0,
      p2Streak: 0,
      isOnline: false,
      p1Ready: false,
      p2Ready: false,
      myReady: false,
      remoteReady: false,
      responseMs: 8,
    };
  }

  classifyFrameState(p) {
    if (p.state === FighterState.HIT_STUN || p.state === FighterState.KNOCKDOWN) return 'HIT_STUN';
    if (p.state === FighterState.BLOCK_STUN) return 'BLOCK_STUN';
    if (p.state === FighterState.JUMP_ARC) {
      if (p.stateFrame >= FRAME_DATA.JUMP.ACTIVE_START && p.stateFrame <= FRAME_DATA.JUMP.ACTIVE_END) return 'ACTIVE';
      return 'JUMP';
    }
    if (p.state === FighterState.ATTACK) {
      if (p.stateFrame < FRAME_DATA.ATTACK.STARTUP) return 'STARTUP';
      if (p.stateFrame < FRAME_DATA.ATTACK.STARTUP + FRAME_DATA.ATTACK.ACTIVE) return 'ACTIVE';
      return 'RECOVERY';
    }
    if (p.state === FighterState.ANTIAIR) {
      if (p.stateFrame < FRAME_DATA.ANTIAIR.STARTUP) return 'STARTUP';
      if (p.stateFrame < FRAME_DATA.ANTIAIR.STARTUP + FRAME_DATA.ANTIAIR.ACTIVE) return 'ANTIAIR_ACTIVE';
      return 'RECOVERY';
    }
    if (p.state === FighterState.THROW) {
      if (p.stateFrame < FRAME_DATA.THROW.STARTUP) return 'STARTUP';
      if (p.stateFrame < FRAME_DATA.THROW.STARTUP + FRAME_DATA.THROW.ACTIVE) return 'THROW_ACTIVE';
      return 'RECOVERY';
    }
    if (p.state === FighterState.WALK_FWD || p.state === FighterState.WALK_BACK) return 'MOVE';
    return 'IDLE';
  }

  recordFrameHistory(state) {
    const idx = state.frame % 60;
    this.p1FrameHistory[idx] = this.classifyFrameState(state.p1);
    this.p2FrameHistory[idx] = this.classifyFrameState(state.p2);
  }

  triggerImpact(shakeAmount = 3.5) {
    this.shakeMag = Math.max(this.shakeMag, shakeAmount);
  }

  render(state, netEngine, coachingPopup) {
    const ctx = this.ctx;
    const W = this.width;
    const H = this.height;

    // 1. Background & Subpixel Smooth Mobile Camera Transform
    ctx.fillStyle = '#090d16';
    ctx.fillRect(0, 0, W, H);

    // Smoothly center camera between P1 and P2 (subpixel floating-point for zero stair-stepping!)
    const targetCamX = (state.p1.x + state.p2.x) * 0.5;
    this.camX += (targetCamX - this.camX) * 0.18;
    const minCam = W * 0.5;
    const maxCam = 1000 - W * 0.5;
    const clampedCamX = Math.max(minCam, Math.min(maxCam, this.camX));

    let shakeX = 0;
    let shakeY = 0;
    if (this.shakeMag > 0.15) {
      shakeX = (Math.sin(state.frame * 2.7) * 0.8) * this.shakeMag;
      shakeY = (Math.cos(state.frame * 3.5) * 0.5) * this.shakeMag;
      this.shakeMag *= 0.68;
    } else {
      this.shakeMag = 0;
    }

    const offsetX = W * 0.5 - clampedCamX + shakeX;

    ctx.save();
    ctx.translate(offsetX, shakeY);

    netEngine.packetPulseIntensity = Math.max(0, netEngine.packetPulseIntensity - 0.06);
    const pulseAlpha = 0.09 + netEngine.packetPulseIntensity * 0.14;
    ctx.strokeStyle = `rgba(56, 189, 248, ${pulseAlpha.toFixed(3)})`;
    ctx.lineWidth = 1;

    // Vertical distance grid lines every 50 units (Batched into a single path for Android GPU performance!)
    ctx.beginPath();
    for (let x = 0; x <= 1000; x += 50) {
      ctx.moveTo(x, 60);
      ctx.lineTo(x, this.groundY + 15);
    }
    ctx.stroke();

    ctx.fillStyle = 'rgba(148, 163, 184, 0.35)';
    ctx.font = '11px monospace';
    for (let x = 100; x < 1000; x += 100) {
      ctx.fillText(`${x}`, x - 10, this.groundY + 28);
    }

    // Stage Walls
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(FRAME_DATA.STAGE_MIN - 28, 80);
    ctx.lineTo(FRAME_DATA.STAGE_MIN - 28, this.groundY);
    ctx.moveTo(FRAME_DATA.STAGE_MAX + 28, 80);
    ctx.lineTo(FRAME_DATA.STAGE_MAX + 28, this.groundY);
    ctx.stroke();

    // Ground Floor Line
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(20, this.groundY);
    ctx.lineTo(980, this.groundY);
    ctx.stroke();

    const selfPlayer = this.localPlayerNum === 2 ? state.p2 : state.p1;
    const enemyPlayer = this.localPlayerNum === 2 ? state.p1 : state.p2;

    // 2. Footsie Range & Throw Range Indicators on Floor (for Local Player learning!)
    if (this.showRangeGuide) {
      this.drawRangeMarkers(ctx, selfPlayer, enemyPlayer);
    }

    // 3. Anti-Air Jump Alert Flash (Visual Cue when Enemy jumps!)
    if (this.showJumpFlash && enemyPlayer.state === FighterState.JUMP_ARC && enemyPlayer.stateFrame <= 18) {
      this.drawJumpAlertIndicator(ctx, enemyPlayer);
    }

    // 4. Rollback Ghost (Cyan transparent stickman showing network rollback correction)
    if (netEngine.ghostTimer > 0 && netEngine.ghostSnapshot) {
      ctx.save();
      ctx.globalAlpha = 0.35;
      const ghostTarget = this.localPlayerNum === 2 ? netEngine.ghostSnapshot.p1 : netEngine.ghostSnapshot.p2;
      this.drawFighter(ctx, ghostTarget, 'Ghost', true);
      ctx.restore();
    }

    // 4.5 Draw Fighters (Stickman + Color-coded Hitboxes + Overhead Self/Enemy Tag)
    const isP1Self = this.localPlayerNum !== 2;
    this.drawFighter(ctx, state.p1, isP1Self ? '▼YOU (1P)' : '1P', false, false, isP1Self);
    this.drawFighter(ctx, state.p2, !isP1Self ? '▼YOU (2P)' : '2P', false, false, !isP1Self);

    // 5. 🙈 Self-Character Blindfold Cover (ON/OFF) - Always covers SELF and leaves ENEMY visible!
    if (this.stealthSelfMode) {
      this.drawSelfBlindfoldCover(ctx, selfPlayer, enemyPlayer);
    }

    // 5.5 Draw Eye-Tracking Reticle on Enemy's chest (shows Self's reach right on Enemy's body!)
    if (this.eyeTrackerGuide) {
      this.drawGazeTargetReticle(ctx, selfPlayer, enemyPlayer);
    }

    ctx.restore(); // End world camera space; draw UI overlays in screen space!

    // 6. Calm Screen-Fixed Distance Status (Top-center of screen)
    const dist = Math.round(Math.abs(state.p1.x - state.p2.x));
    const rangeColor =
      dist <= FRAME_DATA.THROW.REACH
        ? '#4ade80'
        : dist <= FRAME_DATA.ATTACK.REACH
        ? '#f87171'
        : '#94a3b8';

    ctx.fillStyle = rangeColor;
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'center';
    const rangeLabel =
      dist <= FRAME_DATA.THROW.REACH
        ? `距離: ${dist}  [🟩 密着・C投げ間合い]`
        : dist <= FRAME_DATA.ATTACK.REACH
        ? `距離: ${dist}  [🟥 A打撃が届く間合い]`
        : `距離: ${dist}  [🟦 安全・様子見の間合い]`;
    ctx.fillText(rangeLabel, W / 2, 28);
    ctx.textAlign = 'left';

    // 7. Draw 60fps Real-Time Frame Meter at Bottom
    this.drawFrameMeter(ctx, state.frame);

    // 8. Draw Coaching Answer Popup Banner
    if (coachingPopup && coachingPopup.timer > 0 && state.roundState === 'FIGHT') {
      this.drawCoachingPopup(ctx, coachingPopup);
    }

    // 9. Draw Round Over / Match Over Result Banner!
    if (state.roundState === 'ROUND_OVER' || state.roundState === 'MATCH_OVER') {
      this.drawRoundOrMatchResult(ctx, state);
    }
  }

  drawRangeMarkers(ctx, p1, p2) {
    const f = p1.facing;
    const throwX = p1.x + f * FRAME_DATA.THROW.REACH;
    const pokeX = p1.x + f * FRAME_DATA.ATTACK.REACH;

    // Green Throw Range marker
    ctx.fillStyle = 'rgba(34, 197, 94, 0.22)';
    const tx1 = Math.min(p1.x, throwX);
    ctx.fillRect(tx1, this.groundY - 6, FRAME_DATA.THROW.REACH, 6);

    // Red Attack Reach marker
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.65)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pokeX, this.groundY - 14);
    ctx.lineTo(pokeX, this.groundY + 6);
    ctx.stroke();
    ctx.fillStyle = '#f87171';
    ctx.font = '10px sans-serif';
    ctx.fillText('A先端', pokeX - 14, this.groundY - 18);
  }

  drawJumpAlertIndicator(ctx, p2) {
    // Lightweight solid translucent column (avoids per-frame gradient allocation on low-end Android GPUs)
    ctx.save();
    ctx.fillStyle = 'rgba(192, 132, 252, 0.22)';
    ctx.fillRect(p2.x - 42, 80, 84, this.groundY - 80);
    ctx.restore();
  }

  drawFighter(ctx, p, label, isGhost, isStealthSelf = false, isSelf = false) {
    const boxes = getBoxes(p);
    const screenY = (worldY) => this.groundY - worldY;

    ctx.save();
    if (isStealthSelf) {
      // Make P1 nearly invisible (12% opacity) so player is forced to watch P2 only!
      ctx.globalAlpha = 0.12;
    }

    // --- A. Draw Hurtbox ---
    const hb = boxes.hurtbox;
    let hurtFill = 'rgba(59, 130, 246, 0.22)';
    let hurtStroke = '#3b82f6'; // 🟦 Blue normal

    if (hb.type === 'WHIFF_PUNISHABLE') {
      hurtFill = 'rgba(250, 204, 21, 0.35)';
      hurtStroke = '#facc15'; // 🟨 Yellow whiff recovery!
    } else if (hb.type === 'AIR_INVINCIBLE') {
      hurtFill = 'rgba(168, 85, 247, 0.35)';
      hurtStroke = '#a855f7'; // 🟪 Purple Anti-Air Invincibility!
    } else if (hb.type === 'DAMAGED') {
      hurtFill = 'rgba(249, 115, 22, 0.35)';
      hurtStroke = '#f97316';
    }
    if (isGhost) {
      hurtFill = 'rgba(34, 211, 238, 0.15)';
      hurtStroke = '#22d3ee';
    }

    const hx = hb.x1;
    const hy = screenY(hb.y2);
    const hw = hb.x2 - hb.x1;
    const hh = hb.y2 - hb.y1;
    ctx.fillStyle = hurtFill;
    ctx.strokeStyle = hurtStroke;
    ctx.lineWidth = 2;
    ctx.fillRect(hx, hy, hw, hh);
    ctx.strokeRect(hx, hy, hw, hh);

    // Overhead Player Tag (Instant Left/Right recognition on randomized starts)
    if (!isGhost && label) {
      ctx.fillStyle = isSelf ? '#38bdf8' : '#94a3b8';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(label, p.x, hy - 8);
      ctx.textAlign = 'left';
    }

    // --- B. Draw Active Attack Hitbox ---
    if (boxes.hitbox && !isGhost) {
      const ab = boxes.hitbox;
      let hitFill = 'rgba(239, 68, 68, 0.45)';
      let hitStroke = '#ef4444'; // 🟥 Red Strike

      if (ab.type === 'ANTIAIR') {
        hitFill = 'rgba(192, 132, 252, 0.55)';
        hitStroke = '#c084fc'; // 🟪 Purple Anti-Air
      } else if (ab.type === 'THROW') {
        hitFill = 'rgba(34, 197, 94, 0.55)';
        hitStroke = '#22c55e'; // 🟩 Green Throw
      }

      const ax = ab.x1;
      const ay = screenY(ab.y2);
      const aw = ab.x2 - ab.x1;
      const ah = ab.y2 - ab.y1;
      ctx.fillStyle = hitFill;
      ctx.strokeStyle = hitStroke;
      ctx.lineWidth = 2.5;
      ctx.fillRect(ax, ay, aw, ah);
      ctx.strokeRect(ax, ay, aw, ah);
    }

    // --- C. Draw Snap Keyframe Stickman ---
    this.drawKeyframeStickman(ctx, p, isGhost, isSelf);
    ctx.restore();
  }

  // 🙈 Self-Character Blindfold Mask (Works whether 1P is on the Left OR crossed-up to the Right!)
  drawSelfBlindfoldCover(ctx, p1, p2) {
    // Smoothly follow P1's general area so the cover itself doesn't jitter rapidly
    if (this.smoothBlindX === undefined) this.smoothBlindX = p1.x;
    this.smoothBlindX += (p1.x - this.smoothBlindX) * 0.18;

    const coverTop = 75;
    const coverBottom = this.groundY - 4; // Leave the floor line visible so range bar can still be seen!
    const coverHeight = coverBottom - coverTop;
    const isP1OnLeft = p1.x <= p2.x;

    ctx.save();

    if (isP1OnLeft) {
      // Self is on the Left side: Cover from Left edge (0) up to Self's front, never covering Enemy
      const coverRightEdge = Math.max(40, Math.min(this.smoothBlindX + 52, p2.x - 36));
      ctx.fillStyle = 'rgba(11, 15, 25, 0.96)';
      ctx.fillRect(0, coverTop, coverRightEdge, coverHeight);

      ctx.fillStyle = 'rgba(148, 163, 184, 0.55)';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('🙈 自キャラ目隠し中', Math.max(16, p1.x - 120), 115);
    } else {
      // Self is on the Right side: Cover from Self's front all the way to the Right edge (1000)
      const coverLeftEdge = Math.min(960, Math.max(this.smoothBlindX - 52, p2.x + 36));
      ctx.fillStyle = 'rgba(11, 15, 25, 0.96)';
      ctx.fillRect(coverLeftEdge, coverTop, 1000 - coverLeftEdge, coverHeight);

      ctx.fillStyle = 'rgba(148, 163, 184, 0.55)';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('🙈 自キャラ目隠し中', Math.min(984, p1.x + 120), 115);
      ctx.textAlign = 'left';
    }

    // Subtle dashed line showing P1's center position without showing P1's body
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p1.x, coverTop + 20);
    ctx.lineTo(p1.x, coverBottom);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.restore();
  }

  // Eye-Friendly Focal Guide: No moving text!
  // Uses a damped/smoothed focal point in the space slightly in front of Enemy (2P) + a calm color glow on 2P's chest
  drawGazeTargetReticle(ctx, p1, p2) {
    const dist = Math.round(Math.abs(p1.x - p2.x));

    // Smoothly damped focal anchor (70% towards P2, 30% towards P1) so micro-jitters never tire the eyes
    const targetAnchorX = p2.x * 0.75 + p1.x * 0.25;
    if (this.smoothAnchorX === undefined) this.smoothAnchorX = targetAnchorX;
    this.smoothAnchorX += (targetAnchorX - this.smoothAnchorX) * 0.06; // Ultra-calm movement

    const inThrowRange = dist <= FRAME_DATA.THROW.REACH;
    const inPokeRange = dist <= FRAME_DATA.ATTACK.REACH;
    const isWhiffing =
      (p2.state === FighterState.ATTACK && p2.stateFrame >= FRAME_DATA.ATTACK.STARTUP + FRAME_DATA.ATTACK.ACTIVE) ||
      (p2.state === FighterState.THROW && p2.stateFrame >= FRAME_DATA.THROW.STARTUP + FRAME_DATA.THROW.ACTIVE);

    let glowColor = 'rgba(148, 163, 184, 0.45)'; // Safe range
    if (p2.state === FighterState.JUMP_ARC) {
      glowColor = '#c084fc'; // Purple Anti-Air
    } else if (isWhiffing && dist <= FRAME_DATA.ATTACK.REACH + 60) {
      glowColor = '#facc15'; // Yellow Whiff Punish
    } else if (inThrowRange) {
      glowColor = '#4ade80'; // Green Throw
    } else if (inPokeRange) {
      glowColor = '#f87171'; // Red Poke
    }

    ctx.save();

    // 1. Calm Floor Connection Bar between P1 and P2 (Changes color by range, zero text!)
    const leftX = Math.min(p1.x, p2.x);
    const rightX = Math.max(p1.x, p2.x);
    ctx.fillStyle = glowColor;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(leftX, this.groundY + 2, rightX - leftX, 5);

    // 2. Soft, stationary-feeling focal point in the space just in front of Enemy (where pros rest their eyes)
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = glowColor;
    ctx.lineWidth = 2;
    const ay = this.groundY - 68;
    ctx.beginPath();
    ctx.arc(this.smoothAnchorX, ay, 8, 0, Math.PI * 2);
    ctx.stroke();

    // Small center dot on Enemy's chest (color-only, no text!)
    const chestY = this.groundY - p2.y - 62;
    ctx.fillStyle = glowColor;
    ctx.beginPath();
    ctx.arc(p2.x, chestY, 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // Crisp Keyframe Stickman with Smooth Footwork, Breathing & Recovery Retraction
  drawKeyframeStickman(ctx, p, isGhost, isSelf = false) {
    const f = p.facing;
    // Subtle 2px impact vibration during the first 5 frames of hitstun/blockstun
    const stunVib =
      !isGhost && (p.state === FighterState.HIT_STUN || p.state === FighterState.BLOCK_STUN) && p.stateFrame <= 5
        ? (p.stateFrame % 2 === 0 ? 2.5 : -2.5)
        : 0;
    const x = p.x + stunVib;
    const baseY = this.groundY - p.y;

    ctx.save();
    ctx.strokeStyle = isGhost ? '#22d3ee' : isSelf ? '#f8fafc' : '#cbd5e1';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Default Neutral Stance (with subtle idle breathing)
    const breath = p.state === FighterState.IDLE ? Math.sin(p.stateFrame * 0.12) * 1.8 : 0;
    let head = { x: x, y: baseY - 92 + breath };
    let neck = { x: x, y: baseY - 76 + breath };
    let hip = { x: x - f * 4, y: baseY - 40 + breath * 0.5 };
    let handF = { x: x + f * 24, y: baseY - 64 + breath * 1.1 };
    let handB = { x: x - f * 16, y: baseY - 58 + breath * 0.8 };
    let footF = { x: x + f * 18, y: baseY };
    let footB = { x: x - f * 18, y: baseY };

    if (p.state === FighterState.WALK_FWD || p.state === FighterState.WALK_BACK) {
      // Smooth Footsie Stride Animation (no sliding on ice!)
      const dir = p.state === FighterState.WALK_FWD ? 1 : -1;
      const phase = p.stateFrame * 0.42 * dir;
      const stride = Math.sin(phase) * 11;
      const liftF = Math.max(0, Math.cos(phase)) * 4.5;
      const liftB = Math.max(0, -Math.cos(phase)) * 4.5;
      const bob = Math.abs(Math.sin(phase)) * 2.2;

      head = { x: x + f * dir * 4, y: baseY - 92 + bob };
      neck = { x: x + f * dir * 3, y: baseY - 76 + bob };
      hip = { x: x - f * 2, y: baseY - 40 + bob };
      handF = { x: x + f * 24 - stride * 0.25, y: baseY - 64 + bob };
      handB = { x: x - f * 16 + stride * 0.25, y: baseY - 58 + bob };
      footF = { x: x + f * 18 + stride, y: baseY - liftF };
      footB = { x: x - f * 18 - stride, y: baseY - liftB };
    } else if (p.state === FighterState.ATTACK) {
      // 🟥 Sharp Lunging Poke Pose + Smooth Retraction during Whiff Recovery
      const startupEnd = FRAME_DATA.ATTACK.STARTUP;
      const activeEnd = startupEnd + FRAME_DATA.ATTACK.ACTIVE;
      if (p.stateFrame < startupEnd) {
        const t = (p.stateFrame + 1) / startupEnd;
        head = { x: x - f * 8 * t, y: baseY - 88 };
        handF = { x: x - f * 12 * t, y: baseY - 68 };
      } else {
        // Active stays 100% extended; Recovery smoothly retracts in the second half so whiff punish window remains visually clear!
        const recovFrame = Math.max(0, p.stateFrame - activeEnd);
        const pullBack = Math.max(0, (recovFrame - 6) / Math.max(1, FRAME_DATA.ATTACK.RECOVERY - 6));
        const ext = 1 - pullBack * 0.75;
        head = { x: x + f * 18 * ext, y: baseY - 92 + 10 * ext };
        neck = { x: x + f * 14 * ext, y: baseY - 76 + 8 * ext };
        hip = { x: x + f * 6 * ext, y: baseY - 40 + 4 * ext };
        handF = { x: x + f * (24 + (FRAME_DATA.ATTACK.REACH - 34) * ext), y: baseY - 58 };
        footF = { x: x + f * (18 + 16 * ext), y: baseY };
        footB = { x: x - f * (18 + 8 * ext), y: baseY };
      }
    } else if (p.state === FighterState.ANTIAIR) {
      // 🟪 Rising Uppercut / Anti-Air Pose + Smooth Recovery Return
      const activeEnd = FRAME_DATA.ANTIAIR.STARTUP + FRAME_DATA.ANTIAIR.ACTIVE;
      const recovRatio = p.stateFrame > activeEnd
        ? Math.min(1, (p.stateFrame - activeEnd) / FRAME_DATA.ANTIAIR.RECOVERY)
        : 0;
      const ext = 1 - recovRatio * 0.7;
      head = { x: x + f * 8 * ext, y: baseY - 92 - 10 * ext };
      neck = { x: x + f * 6 * ext, y: baseY - 76 - 10 * ext };
      handF = { x: x + f * (24 + 24 * ext), y: baseY - 64 - 106 * ext };
      handB = { x: x - f * 15, y: baseY - 70 };
      footF = { x: x + f * 22, y: baseY - 12 * ext };

      // Draw purple rising uppercut slash arc during active frames!
      if (!isGhost && p.stateFrame >= FRAME_DATA.ANTIAIR.STARTUP && p.stateFrame <= activeEnd + 4) {
        ctx.save();
        ctx.strokeStyle = 'rgba(192, 132, 252, 0.85)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        if (f === 1) {
          ctx.arc(x + 10, baseY - 75, 78, -Math.PI * 0.55, Math.PI * 0.15);
        } else {
          ctx.arc(x - 10, baseY - 75, 78, Math.PI * 0.85, Math.PI * 1.55);
        }
        ctx.stroke();
        ctx.restore();
      }
    } else if (p.state === FighterState.THROW) {
      if (p.hasHit) {
        // 🟩 Dynamic Over-the-Shoulder Throw Follow-Through (Heaving & slamming opponent into the mat!)
        const slamProgress = Math.min(1, p.stateFrame / 11);
        head = { x: x + f * (24 * slamProgress), y: baseY - 82 + 18 * slamProgress };
        neck = { x: x + f * (18 * slamProgress), y: baseY - 68 + 14 * slamProgress };
        hip = { x: x - f * 6, y: baseY - 36 + 6 * slamProgress };
        handF = { x: x + f * (56 * slamProgress), y: baseY - 108 + 86 * slamProgress };
        handB = { x: x + f * (38 * slamProgress), y: baseY - 96 + 76 * slamProgress };
        footF = { x: x + f * 32, y: baseY };
        footB = { x: x - f * 26, y: baseY };

        // Green throw slam trajectory arc
        if (!isGhost && p.stateFrame <= 14) {
          ctx.save();
          ctx.strokeStyle = 'rgba(74, 222, 128, 0.8)';
          ctx.lineWidth = 3.5;
          ctx.setLineDash([8, 5]);
          ctx.beginPath();
          if (f === 1) {
            ctx.arc(x + 35, baseY - 20, 82, -Math.PI * 0.85, -Math.PI * 0.05);
          } else {
            ctx.arc(x - 35, baseY - 20, 82, -Math.PI * 0.95, -Math.PI * 0.15);
          }
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
        }
      } else {
        // 🟩 Grabbing Reach Pose + Smooth Retraction on Whiff
        const activeEnd = FRAME_DATA.THROW.STARTUP + FRAME_DATA.THROW.ACTIVE;
        const recovRatio = p.stateFrame > activeEnd
          ? Math.min(1, (p.stateFrame - activeEnd) / FRAME_DATA.THROW.RECOVERY)
          : 0;
        const ext = 1 - recovRatio * 0.75;
        head = { x: x + f * 12 * ext, y: baseY - 86 };
        handF = { x: x + f * (24 + 44 * ext), y: baseY - 68 };
        handB = { x: x + f * (16 + 42 * ext), y: baseY - 52 };
      }
    } else if (p.state === FighterState.JUMP_ARC) {
      // 🦅 Dive Kick / Jump Attack Pose
      head = { x: x + f * 10, y: baseY - 82 };
      hip = { x: x - f * 8, y: baseY - 45 };
      if (p.stateFrame >= FRAME_DATA.JUMP.ACTIVE_START && p.stateFrame <= FRAME_DATA.JUMP.ACTIVE_END) {
        footF = { x: x + f * 75, y: baseY - 12 };
        footB = { x: x - f * 15, y: baseY - 28 };
      } else {
        footF = { x: x + f * 16, y: baseY - 18 };
        footB = { x: x - f * 16, y: baseY - 22 };
      }
    } else if (p.state === FighterState.BLOCK_STUN) {
      // 🛡️ Guarding Pose
      head = { x: x - f * 6, y: baseY - 86 };
      handF = { x: x + f * 14, y: baseY - 78 };
      handB = { x: x + f * 8, y: baseY - 62 };
    } else if (p.state === FighterState.HIT_STUN) {
      // 💥 Standing Hit-Stun (Reeling back on feet)
      head = { x: x - f * 20, y: baseY - 84 };
      neck = { x: x - f * 12, y: baseY - 68 };
      handF = { x: x - f * 24, y: baseY - 90 };
      handB = { x: x - f * 28, y: baseY - 60 };
    } else if (p.state === FighterState.KNOCKDOWN) {
      // 🌀 Deterministic 3-Phase Knockdown:
      // Phase 1 (0..slamFrame): Full-body Rotational Flip / Uppercut Sky Launch!
      // Phase 2 (slamFrame..stunFrames>6): Mat Impact Bounce & Sprawled Flat on Back!
      // Phase 3 (stunFrames<=6): Crisp Kip-Up Recovery!
      const slamFrame = p.kdType === 'THROW' ? 12 : 13;
      if (p.stateFrame <= slamFrame) {
        const t = p.stateFrame / slamFrame;
        const pivotX = x;
        const pivotY = baseY - 46;
        // Throw rotates head-first (up to 155 deg) into the mat; Anti-Air blasts backward onto back (95 deg)
        const angle = p.kdType === 'THROW'
          ? -f * (0.35 + t * 2.25)
          : -f * (0.45 + t * 1.15);
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        const rot = (rx, ry) => ({
          x: pivotX + rx * cosA - ry * sinA,
          y: pivotY + rx * sinA + ry * cosA,
        });

        head = rot(-f * 6, -42);
        neck = rot(-f * 4, -26);
        hip = rot(f * 4, 10);
        handF = rot(-f * 26, -34);
        handB = rot(f * 22, -20);
        footF = rot(f * 26, 42);
        footB = rot(-f * 16, 36);
      } else if (p.stunFrames > 6 || p.hp <= 0) {
        // 💥 Sprawled Flat on Back on the Floor (with mat bounce & impact shockwave!)
        head = { x: x - f * 40, y: baseY - 13 };
        neck = { x: x - f * 25, y: baseY - 11 };
        hip = { x: x + f * 8, y: baseY - 9 };
        handF = { x: x - f * 46, y: baseY - 3 };
        handB = { x: x - f * 12, y: baseY - 26 };
        footF = { x: x + f * 38, y: baseY - 3 };
        footB = { x: x + f * 24, y: baseY - 20 };

        // Unmistakable Ground Slam Shockwave Ring & Dust Spikes when hitting the mat!
        if (!isGhost && p.stateFrame >= slamFrame && p.stateFrame <= slamFrame + 9) {
          const impactProgress = (p.stateFrame - slamFrame) / 9;
          const ringRadius = 24 + impactProgress * 65;
          ctx.save();
          ctx.strokeStyle =
            p.kdType === 'THROW'
              ? `rgba(74, 222, 128, ${(0.95 * (1 - impactProgress)).toFixed(2)})`
              : `rgba(192, 132, 252, ${(0.95 * (1 - impactProgress)).toFixed(2)})`;
          ctx.lineWidth = 3.5;
          ctx.beginPath();
          ctx.ellipse(x, this.groundY - 2, ringRadius, 10 + impactProgress * 8, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      } else {
        // ⬆️ Smooth Kip-Up / Stand-Up Recovery (Last 6 frames of knockdown)
        const up = Math.max(0, Math.min(1, (6 - p.stunFrames) / 6));
        head = { x: x - f * 40 * (1 - up), y: baseY - (13 + 79 * up) };
        neck = { x: x - f * 25 * (1 - up), y: baseY - (11 + 65 * up) };
        hip = { x: x + f * (8 * (1 - up) - 4 * up), y: baseY - (9 + 31 * up) };
        handF = { x: x + f * (-46 * (1 - up) + 24 * up), y: baseY - (3 + 61 * up) };
        handB = { x: x - f * 14, y: baseY - (26 + 32 * up) };
        footF = { x: x + f * (38 * (1 - up) + 18 * up), y: baseY };
        footB = { x: x + f * (24 * (1 - up) - 18 * up), y: baseY };
      }
    }

    // Draw Head
    ctx.beginPath();
    ctx.arc(head.x, head.y, 11, 0, Math.PI * 2);
    ctx.stroke();

    // Torso & Limbs
    ctx.beginPath();
    ctx.moveTo(neck.x, neck.y);
    ctx.lineTo(hip.x, hip.y);
    // Arms
    ctx.moveTo(neck.x, neck.y);
    ctx.lineTo(handF.x, handF.y);
    ctx.moveTo(neck.x, neck.y);
    ctx.lineTo(handB.x, handB.y);
    // Legs
    ctx.moveTo(hip.x, hip.y);
    ctx.lineTo(footF.x, footF.y);
    ctx.moveTo(hip.x, hip.y);
    ctx.lineTo(footB.x, footB.y);
    ctx.stroke();

    ctx.restore();
  }

  // Real-time 60-Frame State Meter (Mobile-fitted)
  drawFrameMeter(ctx, currentFrame) {
    const cellW = 10.5;
    const cellH = 12;
    const totalMeterW = 60 * cellW;
    const startX = (this.width - totalMeterW) / 2 + 24;
    const meterY = 385;

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(startX - 56, meterY - 6, totalMeterW + 64, 42);
    ctx.strokeStyle = '#334155';
    ctx.strokeRect(startX - 56, meterY - 6, totalMeterW + 64, 42);

    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 11px monospace';
    ctx.fillText('1P(自)', startX - 50, meterY + 10);
    ctx.fillText('2P(敵)', startX - 50, meterY + 26);

    const colorMap = {
      IDLE: '#1e293b',
      MOVE: '#2563eb',          // 🟦 Blue Move
      JUMP: '#0284c7',          // Sky Blue Jump
      STARTUP: '#10b981',       // Teal Startup
      ACTIVE: '#ef4444',        // 🟥 Red Active Hitbox
      ANTIAIR_ACTIVE: '#a855f7',// 🟪 Purple Anti-Air Active
      THROW_ACTIVE: '#22c55e',  // 🟩 Green Throw Active
      RECOVERY: '#eab308',      // 🟨 Yellow Recovery (Whiff Punishable!)
      BLOCK_STUN: '#64748b',    // Guard Stun
      HIT_STUN: '#f97316',      // Orange Hit Stun
    };

    const headIdx = currentFrame % 60;

    for (let i = 0; i < 60; i++) {
      const x = startX + i * cellW;
      ctx.fillStyle = colorMap[this.p1FrameHistory[i]] || '#1e293b';
      ctx.fillRect(x, meterY, cellW - 1, cellH);

      ctx.fillStyle = colorMap[this.p2FrameHistory[i]] || '#1e293b';
      ctx.fillRect(x, meterY + 16, cellW - 1, cellH);

      if (i === headIdx) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.strokeRect(x - 1, meterY - 2, cellW + 1, cellH * 2 + 18);
      }
    }
  }

  drawCoachingPopup(ctx, popup) {
    const boxW = Math.min(720, this.width - 24);
    const boxH = 66;
    const bx = (this.width - boxW) / 2;
    const by = 40;

    ctx.save();
    ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
    ctx.strokeStyle = popup.color || '#38bdf8';
    ctx.lineWidth = 2.5;
    ctx.fillRect(bx, by, boxW, boxH);
    ctx.strokeRect(bx, by, boxW, boxH);

    ctx.fillStyle = popup.color || '#38bdf8';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(popup.title, this.width / 2, by + 25);

    ctx.fillStyle = '#f1f5f9';
    ctx.font = '13px sans-serif';
    ctx.fillText(popup.reason, this.width / 2, by + 49);
    ctx.restore();
  }

  drawRoundOrMatchResult(ctx, state) {
    const W = this.width;
    const H = this.height;
    const mySide = this.localPlayerNum === 2 ? 'P2' : 'P1';
    const didWin = state.winner === mySide;
    const info = this.matchOverlayInfo;

    ctx.save();
    if (state.roundState === 'ROUND_OVER') {
      // Snappy Round K.O. Banner
      ctx.fillStyle = 'rgba(9, 13, 22, 0.78)';
      ctx.fillRect(0, 120, W, 110);
      ctx.strokeStyle = didWin ? '#4ade80' : '#f87171';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, 120);
      ctx.lineTo(W, 120);
      ctx.moveTo(0, 230);
      ctx.lineTo(W, 230);
      ctx.stroke();

      ctx.fillStyle = didWin ? '#4ade80' : '#f87171';
      ctx.font = '900 34px sans-serif';
      ctx.textAlign = 'center';
      const msg = state.roundTimer <= 0 ? 'TIME UP!' : 'K.O.!!';
      ctx.fillText(`${msg}  ${didWin ? 'ROUND WIN!' : 'ROUND LOSE...'}`, W / 2, 172);

      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 16px sans-serif';
      ctx.fillText(`まもなく ROUND ${state.roundNum + 1} が始まります...`, W / 2, 206);
    } else if (state.roundState === 'MATCH_OVER') {
      // Full Match Finish Result Card + Win Streak + P2P Instant Rematch!
      ctx.fillStyle = 'rgba(7, 10, 18, 0.88)';
      ctx.fillRect(0, 0, W, H);

      const cardW = 580;
      const cardH = 278;
      const cx = (W - cardW) / 2;
      const cy = 48;

      ctx.fillStyle = '#0f172a';
      ctx.strokeStyle = didWin ? '#4ade80' : '#f87171';
      ctx.lineWidth = 3;
      ctx.fillRect(cx, cy, cardW, cardH);
      ctx.strokeRect(cx, cy, cardW, cardH);

      ctx.fillStyle = didWin ? '#4ade80' : '#f87171';
      ctx.font = '900 34px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(didWin ? '🏆 YOU WIN!! (勝利！)' : '💥 YOU LOSE... (惜敗)', W / 2, cy + 48);

      ctx.fillStyle = '#e2e8f0';
      ctx.font = 'bold 17px monospace';
      ctx.fillText(
        `ROUND : 1P [${state.p1Wins}] - [${state.p2Wins}] 2P   ｜   通算セット : 1P ${info.p1SetWins}勝 - ${info.p2SetWins}勝 2P`,
        W / 2,
        cy + 86
      );

      // 🔥 WIN STREAK Banner
      const myStreak = this.localPlayerNum === 2 ? info.p2Streak : info.p1Streak;
      const enemyStreak = this.localPlayerNum === 2 ? info.p1Streak : info.p2Streak;

      if (myStreak >= 2) {
        ctx.fillStyle = '#fb923c';
        ctx.font = '900 20px sans-serif';
        ctx.fillText(`🔥🔥 現在 ${myStreak}連勝中！！ (${myStreak} WIN STREAK!) 🔥🔥`, W / 2, cy + 124);
      } else if (myStreak === 1) {
        ctx.fillStyle = '#fde047';
        ctx.font = 'bold 16px sans-serif';
        ctx.fillText('🔥 1連勝スタート！このリズムで連勝を伸ばそう！', W / 2, cy + 124);
      } else if (enemyStreak >= 2) {
        ctx.fillStyle = '#f87171';
        ctx.font = 'bold 16px sans-serif';
        ctx.fillText(`⚡ 相手が ${enemyStreak}連勝中！次の試合で連勝をストップしよう！`, W / 2, cy + 124);
      } else {
        ctx.fillStyle = '#94a3b8';
        ctx.font = 'bold 15px sans-serif';
        ctx.fillText('なぜ被弾したかを思い出し、目隠しや対空意識でもう1セット挑戦！', W / 2, cy + 124);
      }

      if (info.isOnline) {
        // P2P Ready Status Indicator
        const p1Tag = info.p1Ready ? '🟢 1P READY!' : '⚪ 1P 待機中';
        const p2Tag = info.p2Ready ? '🟢 2P READY!' : '⚪ 2P 待機中';
        ctx.fillStyle = '#38bdf8';
        ctx.font = 'bold 15px monospace';
        ctx.fillText(`${p1Tag}    ⇔    ${p2Tag}`, W / 2, cy + 162);

        const btnW = 480;
        const btnH = 54;
        const bx = W / 2 - btnW / 2;
        const by = cy + 180;

        if (info.remoteReady) {
          ctx.fillStyle = '#16a34a';
          ctx.strokeStyle = '#4ade80';
        } else if (info.myReady) {
          ctx.fillStyle = '#0284c7';
          ctx.strokeStyle = '#38bdf8';
        } else {
          ctx.fillStyle = '#2563eb';
          ctx.strokeStyle = '#38bdf8';
        }
        ctx.lineWidth = 2.5;
        ctx.fillRect(bx, by, btnW, btnH);
        ctx.strokeRect(bx, by, btnW, btnH);

        ctx.fillStyle = '#ffffff';
        ctx.font = '900 16px sans-serif';
        if (info.remoteReady) {
          ctx.fillText(
            `⚡ 相手が再戦ボタンを押しました！(応答 ${info.responseMs}ms) タップで即開始！`,
            W / 2,
            by + 33
          );
        } else if (info.myReady) {
          ctx.fillText(
            `⚡ P2P再戦シグナル送信済 (応答 ${info.responseMs}ms) — 相手のボタン待ち`,
            W / 2,
            by + 33
          );
        } else {
          ctx.fillText('⚡ 画面タップ または【A/B/Cボタン】でP2P即再戦！', W / 2, by + 33);
        }
      } else {
        // Offline CPU Dojo Instant Rematch Button
        const btnW = 420;
        const btnH = 56;
        const bx = W / 2 - btnW / 2;
        const by = cy + 166;

        ctx.fillStyle = '#2563eb';
        ctx.fillRect(bx, by, btnW, btnH);
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2.5;
        ctx.strokeRect(bx, by, btnW, btnH);

        ctx.fillStyle = '#ffffff';
        ctx.font = '900 18px sans-serif';
        ctx.fillText('⚡ 画面タップ または【A/B/Cボタン】で即再戦！', W / 2, by + 35);
      }
    }
    ctx.restore();
  }
}
