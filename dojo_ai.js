// Specialized Training Dojo AI for practicing Anti-Air, Close RPS (3-sukumi), and Whiff Punishing
import { INPUT_BITS, FighterState } from './state.js?v=14';

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
    this.cooldown = randInt(10, 28);
    this.intentTimer = 0;
    this.currentIntent = 'FOOTSIES';
    this.moveTimer = 0;
    this.moveBit = 0;
    this.nextOffense = null; // 'JUMP' | 'POKE' | null
    this.lastAiState = FighterState.IDLE;
    this.currentHint = '地上戦（ウロウロ）しながら、CPUが飛んだ瞬間に【B：対空】を押してください！';
  }

  setMode(mode) {
    this.mode = mode;
    this.cooldown = randInt(10, 26);
    this.intentTimer = 0;
    this.moveTimer = 0;
    this.nextOffense = null;
  }

  isAiActionable(ai) {
    return (
      ai.state === FighterState.IDLE ||
      ai.state === FighterState.WALK_FWD ||
      ai.state === FighterState.WALK_BACK
    );
  }

  // Pick a random human-like footsie footwork rhythm inside combat range (135 ~ 210)
  nextRandomFootwork(towardBit, awayBit, dist) {
    if (dist > 208) {
      this.moveTimer = randInt(8, 16);
      this.moveBit = towardBit;
      return this.moveBit;
    }
    if (dist < 130) {
      this.moveTimer = randInt(7, 15);
      this.moveBit = awayBit;
      return this.moveBit;
    }
    const r = Math.random();
    if (r < 0.48) {
      // Step forward (pressure / dash feint)
      this.moveTimer = randInt(6, 16);
      this.moveBit = towardBit;
    } else if (r < 0.80) {
      // Shimmy back (spacing / guard)
      this.moveTimer = randInt(6, 16);
      this.moveBit = awayBit;
    } else {
      // Micro-stop (stand still in neutral to throw off player's timing!)
      this.moveTimer = randInt(5, 13);
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

    // Reset opening aggression at the start of every round so CPU attacks right away!
    if (state.frame <= 2) {
      this.cooldown = randInt(8, 24);
      this.moveTimer = 0;
      this.nextOffense = null;
    }

    if (this.cooldown > 0) this.cooldown--;
    if (this.intentTimer > 0) this.intentTimer--;
    if (this.moveTimer > 0) this.moveTimer--;

    // Prevent the "always jumps on Frame 1 after blocking Player's A" habit, while keeping active pressure
    const wasInStun =
      this.lastAiState === FighterState.BLOCK_STUN ||
      this.lastAiState === FighterState.HIT_STUN ||
      this.lastAiState === FighterState.KNOCKDOWN;
    this.lastAiState = ai.state;
    if (wasInStun && this.isAiActionable(ai)) {
      this.cooldown = randInt(8, 38);
      this.moveTimer = randInt(6, 15);
      this.nextOffense = null;
      this.moveBit = Math.random() < 0.55 ? awayBit : (Math.random() < 0.5 ? towardBit : 0);
    }

    // =========================================================================
    // DRILL 1: 地上戦＋対空リアクション道場 (Proactive & Unpredictable Footsies + Jump-ins)
    // =========================================================================
    if (this.mode === DOJO_MODES.ANTIAIR_DRILL) {
      this.currentHint = '【対空道場】ランダムな前後ステップ・A牽制・フェイントに惑わされず、飛んだ瞬間だけ【B：対空】！';

      // Close gap proactively into combat range (<= 245) without wasting cooldown!
      if (dist > 245) {
        return towardBit;
      }

      // When cooldown expires, ALWAYS commit to a proactive offensive action (Jump or Ground Poke)
      if (this.cooldown === 0 && this.isAiActionable(ai)) {
        if (!this.nextOffense) {
          this.nextOffense = Math.random() < 0.55 ? 'JUMP' : 'POKE';
        }

        if (this.nextOffense === 'JUMP') {
          if (dist < 130) {
            if (Math.random() < 0.5) {
              this.nextOffense = 'POKE';
            } else {
              return awayBit;
            }
          } else {
            // 🦅 Sudden Jump-In! Next action cooldown is randomized (22F ~ 82F)
            this.nextOffense = null;
            this.cooldown = Math.random() < 0.32 ? randInt(22, 38) : randInt(40, 82);
            this.moveTimer = randInt(6, 15);
            return towardBit | INPUT_BITS.JUMP;
          }
        }

        if (this.nextOffense === 'POKE') {
          // Walk into A poke range (<= 192) before swinging so it actually threatens/hits the player!
          if (dist > 192) {
            return towardBit;
          }
          // 🟥 Ground Poke (A)! Sometimes chains quickly into another poke/jump, sometimes pauses
          this.nextOffense = null;
          this.cooldown = Math.random() < 0.38 ? randInt(14, 28) : randInt(32, 74);
          this.moveTimer = randInt(6, 15);
          return INPUT_BITS.ATTACK;
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
