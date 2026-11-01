// Specialized Training Dojo AI for practicing Anti-Air, Close RPS (3-sukumi), and Whiff Punishing
import { INPUT_BITS, FighterState } from './state.js';

export const DOJO_MODES = {
  ANTIAIR_DRILL: 'ANTIAIR_DRILL',     // Drill 1: Ground Footsies + Sudden Jump-in! (Practice pressing B on reaction)
  RPS_DRILL: 'RPS_DRILL',             // Drill 2: Close-range 3-Sukumi (Strike vs Throw vs Guard)
  WHIFF_DRILL: 'WHIFF_DRILL',         // Drill 3: Whiff Punish (Walk back out of range, hit yellow limb with A)
  FREE_SPARRING: 'FREE_SPARRING',     // Drill 4: All-round CPU Sparring
};

export class DojoTrainerAI {
  constructor() {
    this.mode = DOJO_MODES.ANTIAIR_DRILL;
    this.cooldown = 0;
    this.intentTimer = 0;
    this.currentIntent = 'FOOTSIES';
    this.rpsPatternIndex = 0;
    // Tell the player what the CPU is thinking in Drill mode so they understand the "Why"
    this.currentHint = '地上戦（ウロウロ）しながら、CPUが飛んだ瞬間に【B：対空】を押してください！';
  }

  setMode(mode) {
    this.mode = mode;
    this.cooldown = 20;
    this.intentTimer = 0;
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

    // =========================================================================
    // DRILL 1: 地上戦＋対空リアクション道場 (Anti-Air Reaction Training)
    // =========================================================================
    if (this.mode === DOJO_MODES.ANTIAIR_DRILL) {
      this.currentHint = '【対空道場】地上のA牽制に気をつけつつ、頭上が光って飛んで来たら即【B：対空】！';

      // If too far, walk closer into jump/footsie range (175 ~ 250 units)
      if (dist > 250) {
        return towardBit;
      }
      if (dist < 140) {
        return awayBit;
      }

      if (this.cooldown === 0 && ai.state === FighterState.IDLE) {
        const roll = Math.random();
        if (roll < 0.48) {
          // Jump in!
          this.cooldown = 85;
          return towardBit | INPUT_BITS.JUMP;
        } else if (roll < 0.78) {
          // Ground Poke (A) to keep player's mental stack occupied on the ground!
          this.cooldown = 60;
          return INPUT_BITS.ATTACK;
        } else {
          // Shimmy / Walk back and forth
          this.cooldown = 35;
          return awayBit;
        }
      }

      // Wiggle back and forth at mid-range
      return (Math.floor(state.frame / 18) % 2 === 0) ? towardBit : awayBit;
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

      // Now in close range! Pick one of the 3 RPS options clearly
      if (this.intentTimer <= 0) {
        const options = ['GUARD_WAIT', 'THROW_ATTEMPT', 'STRIKE_CHECK'];
        this.currentIntent = options[this.rpsPatternIndex % options.length];
        this.rpsPatternIndex++;
        this.intentTimer = 95;
      }

      if (this.currentIntent === 'GUARD_WAIT') {
        this.currentHint = '💡 CPUのクセ：【ガード固め】中！ → 密着して【C：投げ】で崩そう！';
        return awayBit; // Holding back to auto-guard
      } else if (this.currentIntent === 'THROW_ATTEMPT') {
        this.currentHint = '💡 CPUのクセ：【投げ（C）】を狙っています！ → 【A：打撃】か【↑：ジャンプ】で潰そう！';
        if (this.cooldown === 0) {
          this.cooldown = 45;
          return INPUT_BITS.THROW;
        }
        return towardBit;
      } else {
        this.currentHint = '💡 CPUのクセ：【打撃（A）暴れ】を狙っています！ → 【←：後ろガード】して反撃しよう！';
        if (this.cooldown === 0) {
          this.cooldown = 48;
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

      if (this.cooldown === 0) {
        this.cooldown = 65;
        return INPUT_BITS.ATTACK; // Whiff in front of the player!
      }
      return awayBit;
    }

    // =========================================================================
    // DRILL 4: 実践スパーリング (Full CPU Match)
    // =========================================================================
    this.currentHint = '【実践スパーリング】中距離はAと差し返し、近づかれたら投げ警戒、飛んできたらB対空！';

    // React to player jump some of the time
    if (player.state === FighterState.JUMP_ARC && player.stateFrame > 16 && dist < 130 && Math.random() < 0.08) {
      return INPUT_BITS.ANTIAIR;
    }

    if (dist > 220) return towardBit;
    if (dist < 72 && this.cooldown === 0) {
      this.cooldown = 35;
      return Math.random() < 0.5 ? INPUT_BITS.THROW : INPUT_BITS.ATTACK;
    }
    if (this.cooldown === 0) {
      this.cooldown = 50;
      const r = Math.random();
      if (r < 0.35) return INPUT_BITS.ATTACK;
      if (r < 0.58) return towardBit | INPUT_BITS.JUMP;
      return awayBit;
    }
    return (Math.floor(state.frame / 20) % 2 === 0) ? awayBit : towardBit;
  }
}
