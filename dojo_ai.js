// Specialized Training Dojo AI for practicing Anti-Air, Close RPS (3-sukumi), and Whiff Punishing
import { INPUT_BITS, FighterState } from './state.js?v=10';

export const DOJO_MODES = {
  ANTIAIR_DRILL: 'ANTIAIR_DRILL',     // Drill 1: Ground Footsies + Sudden Jump-in! (Practice pressing B on reaction)
  RPS_DRILL: 'RPS_DRILL',             // Drill 2: Close-range 3-Sukumi (Strike vs Throw vs Guard)
  WHIFF_DRILL: 'WHIFF_DRILL',         // Drill 3: Whiff Punish (Walk back out of range, hit yellow limb with A)
  FREE_SPARRING: 'FREE_SPARRING',     // Drill 4: All-round CPU Sparring
};

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export class DojoTrainerAI {
  constructor() {
    this.mode = DOJO_MODES.ANTIAIR_DRILL;
    this.cooldown = randInt(25, 55);
    this.intentTimer = 0;
    this.currentIntent = 'FOOTSIES';
    this.moveTimer = 0;
    this.moveBit = 0;
    this.lastAiState = FighterState.IDLE;
    this.currentHint = '地上戦（ウロウロ）しながら、CPUが飛んだ瞬間に【B：対空】を押してください！';
  }

  setMode(mode) {
    this.mode = mode;
    this.cooldown = randInt(20, 45);
    this.intentTimer = 0;
    this.moveTimer = 0;
  }

  isAiActionable(ai) {
    return (
      ai.state === FighterState.IDLE ||
      ai.state === FighterState.WALK_FWD ||
      ai.state === FighterState.WALK_BACK
    );
  }

  // Pick a random human-like footsie footwork rhythm (forward, back, or neutral stop feint)
  nextRandomFootwork(towardBit, awayBit, dist) {
    if (dist > 255) {
      this.moveTimer = randInt(10, 22);
      this.moveBit = towardBit;
      return this.moveBit;
    }
    if (dist < 125) {
      this.moveTimer = randInt(8, 18);
      this.moveBit = awayBit;
      return this.moveBit;
    }
    const r = Math.random();
    if (r < 0.42) {
      // Step forward (pressure / dash feint)
      this.moveTimer = randInt(7, 20);
      this.moveBit = towardBit;
    } else if (r < 0.80) {
      // Shimmy back (spacing / guard)
      this.moveTimer = randInt(8, 22);
      this.moveBit = awayBit;
    } else {
      // Micro-stop (stand still in neutral to throw off player's timing!)
      this.moveTimer = randInt(6, 16);
      this.moveBit = 0;
    }
    return this.moveBit;
  }

  getInput(state) {
    const ai = state.p2;
    const player = state.p1;
    const dist = Math.abs(ai.x - player.x);

    // Direction towards player
    const towardBit = ai.x > player.x ? INPUT_BITS.LEFT : INPUT_BITS.RIGHT;
    const awayBit = ai.x > player.x ? INPUT_BITS.RIGHT : INPUT_BITS.LEFT;

    if (this.cooldown > 0) this.cooldown--;
    if (this.intentTimer > 0) this.intentTimer--;
    if (this.moveTimer > 0) this.moveTimer--;

    // Prevent the "always jumps immediately after blocking/getting hit by Player's A" habit!
    const wasInStun =
      this.lastAiState === FighterState.BLOCK_STUN ||
      this.lastAiState === FighterState.HIT_STUN ||
      this.lastAiState === FighterState.KNOCKDOWN;
    this.lastAiState = ai.state;
    if (wasInStun && this.isAiActionable(ai)) {
      // Add an unpredictable delay or immediate ground counter/shimmy after blocking/wakeup
      this.cooldown = Math.max(this.cooldown, randInt(12, 52));
      this.moveTimer = randInt(8, 20);
      this.moveBit = Math.random() < 0.65 ? awayBit : (Math.random() < 0.5 ? towardBit : 0);
    }

    // =========================================================================
    // DRILL 1: 地上戦＋対空リアクション道場 (Unpredictable Human-Like Footsies & Jump-ins)
    // =========================================================================
    if (this.mode === DOJO_MODES.ANTIAIR_DRILL) {
      this.currentHint = '【対空道場】ランダムな前後ステップ・A牽制・フェイントに惑わされず、飛んだ瞬間だけ【B：対空】！';

      // Keep within footsie & jump engagement zone (125 ~ 260)
      if (dist > 265) {
        return towardBit;
      }

      // Trigger offensive actions from ANY ground movement state (walking forward, walking back, or standing)
      if (this.cooldown === 0 && this.isAiActionable(ai)) {
        const roll = Math.random();

        if (roll < 0.42 && dist >= 135 && dist <= 255) {
          // 🦅 Sudden Jump-In! Next action cooldown is randomized (35F ~ 95F) so rhythm never repeats
          this.cooldown = randInt(38, 95);
          this.moveTimer = randInt(8, 18);
          return towardBit | INPUT_BITS.JUMP;
        } else if (roll < 0.72 && dist <= 210) {
          // 🟥 Ground Poke (A)! Sometimes followed quickly by another action, sometimes a long pause
          this.cooldown = Math.random() < 0.35 ? randInt(18, 32) : randInt(42, 80);
          return INPUT_BITS.ATTACK;
        } else if (roll < 0.86) {
          // 🏃 Aggressive Step-In Feint (walks forward as if to poke/throw, testing player's patience!)
          this.moveBit = towardBit;
          this.moveTimer = randInt(12, 24);
          this.cooldown = randInt(14, 34);
          return towardBit;
        } else {
          // 🛑 Sudden Stop / Back-walk Bait
          this.moveBit = Math.random() < 0.5 ? 0 : awayBit;
          this.moveTimer = randInt(10, 22);
          this.cooldown = randInt(15, 40);
          return this.moveBit;
        }
      }

      if (this.moveTimer <= 0) {
        return this.nextRandomFootwork(towardBit, awayBit, dist);
      }
      return this.moveBit;
    }

    // =========================================================================
    // DRILL 2: 密着3すくみ（じゃんけん）道場 (Close Range Strike / Throw / Guard)
    // =========================================================================
    if (this.mode === DOJO_MODES.RPS_DRILL) {
      // Walk right up to the player to create close-range RPS situations
      if (dist > 82) {
        if (this.intentTimer > 0 && this.currentIntent === 'GUARD_WAIT') {
          this.currentHint = '💡 CPUは【ガード（様子見）】で固まっています！近づいて【C：投げ】で崩しましょう！';
          return awayBit;
        }
        return towardBit;
      }

      // Now in close range! Pick one of the 3 RPS options at random
      if (this.intentTimer <= 0) {
        const options = ['GUARD_WAIT', 'THROW_ATTEMPT', 'STRIKE_CHECK'];
        this.currentIntent = options[randInt(0, options.length - 1)];
        this.intentTimer = randInt(70, 110);
      }

      if (this.currentIntent === 'GUARD_WAIT') {
        this.currentHint = '💡 CPUのクセ：【ガード固め】中！ → 密着して【C：投げ】で崩そう！';
        return awayBit; // Holding back to auto-guard
      } else if (this.currentIntent === 'THROW_ATTEMPT') {
        this.currentHint = '💡 CPUのクセ：【投げ（C）】を狙っています！ → 【A：打撃】か【↑：ジャンプ】で潰そう！';
        if (this.cooldown === 0 && this.isAiActionable(ai)) {
          this.cooldown = randInt(32, 55);
          return INPUT_BITS.THROW;
        }
        return towardBit;
      } else {
        this.currentHint = '💡 CPUのクセ：【打撃（A）暴れ】を狙っています！ → 【←：後ろガード】して反撃しよう！';
        if (this.cooldown === 0 && this.isAiActionable(ai)) {
          this.cooldown = randInt(35, 58);
          return INPUT_BITS.ATTACK;
        }
        return awayBit;
      }
    }

    // =========================================================================
    // DRILL 3: 差し返し（空振り狩り）道場 (Whiff Punish Training)
    // =========================================================================
    if (this.mode === DOJO_MODES.WHIFF_DRILL) {
      this.currentHint = '【差し返し道場】距離170〜190（赤ラインのすぐ外）を後ろ歩きでキープし、CPUが空振りした黄色い腕に【A：打撃】！';

      if (dist > 205) return towardBit;
      if (dist < 155) return awayBit;

      if (this.cooldown === 0 && this.isAiActionable(ai)) {
        this.cooldown = randInt(40, 80);
        return INPUT_BITS.ATTACK; // Whiff in front of the player at varied intervals!
      }
      if (this.moveTimer <= 0) {
        return this.nextRandomFootwork(towardBit, awayBit, dist);
      }
      return this.moveBit;
    }

    // =========================================================================
    // DRILL 4: 実践スパーリング (Full CPU Match)
    // =========================================================================
    this.currentHint = '【実践スパーリング】中距離はAと差し返し、近づかれたら投げ警戒、飛んできたらB対空！';

    // React to player jump some of the time
    if (player.state === FighterState.JUMP_ARC && player.stateFrame > 16 && dist < 130 && Math.random() < 0.08) {
      return INPUT_BITS.ANTIAIR;
    }

    if (dist > 235) return towardBit;
    if (dist < 72 && this.cooldown === 0 && this.isAiActionable(ai)) {
      this.cooldown = randInt(28, 48);
      return Math.random() < 0.5 ? INPUT_BITS.THROW : INPUT_BITS.ATTACK;
    }
    if (this.cooldown === 0 && this.isAiActionable(ai)) {
      this.cooldown = randInt(28, 70);
      const r = Math.random();
      if (r < 0.36) return INPUT_BITS.ATTACK;
      if (r < 0.62) return towardBit | INPUT_BITS.JUMP;
      return awayBit;
    }
    if (this.moveTimer <= 0) {
      return this.nextRandomFootwork(towardBit, awayBit, dist);
    }
    return this.moveBit;
  }
}
