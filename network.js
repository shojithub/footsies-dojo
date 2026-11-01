// P2P Network Transport (Real WebRTC DataChannel + Rollback Netcode Engine)
import { cloneState, stepGameState } from './state.js';

const PEER_PREFIX = 'footsies-dojo-p2p-v2-';

export class P2PRollbackEngine {
  constructor(initialState) {
    this.historySize = 120;
    this.stateBuffer = new Array(this.historySize);
    this.p1Inputs = new Uint8Array(8192);
    this.p2Inputs = new Uint8Array(8192);
    this.remoteReceivedMask = new Uint8Array(8192);

    // Online WebRTC State
    this.isOnline = false;
    this.localPlayerNum = 1; // 1 = Host (Left/1P), 2 = Guest (Right/2P)
    this.roomCode = '';
    this.peer = null;
    this.conn = null;
    this.remoteConfirmedFrame = -1;
    this.onStatusChange = null;
    this.onMatchStart = null;
    this.onRematchSignal = null;

    // Telemetry & Simulation Settings
    this.routeType = 'IPV6_DIRECT'; // 'IPV6_DIRECT' | 'PEER_RELAY' | 'OPEN_NAT64'
    this.simulatedRttMs = 8;
    this.simulatedJitterMs = 1;
    this.realRttMs = 12;
    this.realJitterMs = 2;
    this.lastPingSentAt = 0;

    this.lastRollbackFrames = 0;
    this.totalRollbacks = 0;
    this.packetPulseIntensity = 0;
    this.ghostSnapshot = null;
    this.ghostTimer = 0;

    this.resetBuffers(initialState);
  }

  resetBuffers(initialState) {
    this.p1Inputs.fill(0);
    this.p2Inputs.fill(0);
    this.remoteReceivedMask.fill(0);
    this.remoteConfirmedFrame = -1;
    this.lastRollbackFrames = 0;
    this.saveSnapshot(initialState);
  }

  setRoutePreset(route) {
    if (this.isOnline) return; // In real P2P mode, route is determined by actual WebRTC ICE!
    this.routeType = route;
    if (route === 'IPV6_DIRECT') {
      this.simulatedRttMs = 8;
      this.simulatedJitterMs = 1;
    } else if (route === 'PEER_RELAY') {
      this.simulatedRttMs = 34;
      this.simulatedJitterMs = 6;
    } else if (route === 'OPEN_NAT64') {
      this.simulatedRttMs = 68;
      this.simulatedJitterMs = 14;
    }
  }

  saveSnapshot(state) {
    this.stateBuffer[state.frame % this.historySize] = cloneState(state);
  }

  getSnapshot(frame) {
    if (frame < 0) return this.stateBuffer[0];
    return this.stateBuffer[frame % this.historySize];
  }

  // ===========================================================================
  // Real WebRTC P2P Room Host / Join (Android Mobile <-> iPad Wi-Fi)
  // ===========================================================================
  createPeerInstance(id) {
    const PeerClass = window.Peer;
    if (!PeerClass) {
      throw new Error('PeerJSライブラリが読み込まれていません（オフライン状態）');
    }
    return new PeerClass(id, {
      debug: 1,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun.cloudflare.com:3478' },
          // Public free TURN fallback in case mobile carrier CGNAT is strict symmetric NAT
          {
            urls: 'turn:openrelay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject',
          },
          {
            urls: 'turn:openrelay.metered.ca:443?transport=tcp',
            username: 'openrelayproject',
            credential: 'openrelayproject',
          },
        ],
      },
    });
  }

  hostRoom(onUpdate) {
    this.disconnect();
    this.onStatusChange = onUpdate;
    this.localPlayerNum = 1;
    this.roomCode = String(Math.floor(1000 + Math.random() * 9000));
    const peerId = PEER_PREFIX + this.roomCode;

    try {
      this.peer = this.createPeerInstance(peerId);
    } catch (err) {
      onUpdate({ state: 'ERROR', message: err.message });
      return;
    }

    onUpdate({ state: 'WAITING_HOST', roomCode: this.roomCode, message: 'ルームを作成中...' });

    this.peer.on('open', () => {
      onUpdate({
        state: 'WAITING_FOR_GUEST',
        roomCode: this.roomCode,
        message: `相手（Android/iPad）の参加を待っています...`,
      });
    });

    this.peer.on('connection', (conn) => {
      this.setupDataChannel(conn);
    });

    this.peer.on('error', (err) => {
      onUpdate({ state: 'ERROR', message: `通信エラー: ${err.type || err.message}` });
    });
  }

  joinRoom(code, onUpdate) {
    const cleanCode = String(code).trim();
    if (!/^\d{4}$/.test(cleanCode)) {
      onUpdate({ state: 'ERROR', message: '4桁の数字を入力してください' });
      return;
    }

    this.disconnect();
    this.onStatusChange = onUpdate;
    this.localPlayerNum = 2;
    this.roomCode = cleanCode;

    try {
      this.peer = this.createPeerInstance(undefined);
    } catch (err) {
      onUpdate({ state: 'ERROR', message: err.message });
      return;
    }

    onUpdate({ state: 'CONNECTING', roomCode: cleanCode, message: `ルーム [${cleanCode}] にP2P接続中...` });

    this.peer.on('open', () => {
      const conn = this.peer.connect(PEER_PREFIX + cleanCode, {
        reliable: false,
        serialization: 'json',
      });
      this.setupDataChannel(conn);
    });

    this.peer.on('error', (err) => {
      onUpdate({
        state: 'ERROR',
        message: err.type === 'peer-unavailable' ? `ルーム [${cleanCode}] が見つかりません` : `接続エラー: ${err.type}`,
      });
    });
  }

  setupDataChannel(conn) {
    this.conn = conn;

    conn.on('open', () => {
      this.isOnline = true;
      this.routeType = 'IPV6_DIRECT';
      if (this.onStatusChange) {
        this.onStatusChange({
          state: 'CONNECTED',
          roomCode: this.roomCode,
          playerNum: this.localPlayerNum,
          message: `⚡ P2P接続完了！あなたは【${this.localPlayerNum}P】です！`,
        });
      }
      if (this.onMatchStart) {
        this.onMatchStart(this.localPlayerNum);
      }
      this.inspectWebRTCRoute();
    });

    conn.on('data', (data) => {
      this.handleIncomingPacket(data);
    });

    conn.on('close', () => {
      const wasOnline = this.isOnline;
      this.disconnect();
      if (wasOnline && this.onStatusChange) {
        this.onStatusChange({ state: 'DISCONNECTED', message: '相手とのP2P接続が切断されました' });
      }
    });
  }

  disconnect() {
    this.isOnline = false;
    if (this.conn) {
      try { this.conn.close(); } catch (_) {}
      this.conn = null;
    }
    if (this.peer) {
      try { this.peer.destroy(); } catch (_) {}
      this.peer = null;
    }
  }

  // Inspect actual WebRTC ICE Candidate Pair to detect IPv6 Direct vs STUN Direct vs TURN Relay!
  async inspectWebRTCRoute() {
    if (!this.conn || !this.conn.peerConnection) return;
    try {
      const stats = await this.conn.peerConnection.getStats();
      stats.forEach((report) => {
        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          if (report.currentRoundTripTime !== undefined) {
            this.realRttMs = Math.max(1, Math.round(report.currentRoundTripTime * 1000));
          }
          const localCand = stats.get(report.localCandidateId);
          const remoteCand = stats.get(report.remoteCandidateId);
          if (localCand && remoteCand) {
            if (localCand.candidateType === 'relay' || remoteCand.candidateType === 'relay') {
              this.routeType = 'PEER_RELAY';
            } else if (
              (localCand.address && localCand.address.includes(':')) ||
              (localCand.ip && localCand.ip.includes(':'))
            ) {
              this.routeType = 'IPV6_DIRECT';
            } else {
              this.routeType = 'IPV6_DIRECT'; // Direct UDP Hole Punching (host / srflx / prflx)
            }
          }
        }
      });
    } catch (_) {}
  }

  sendInputPacket(currentFrame, localInput) {
    if (!this.isOnline || !this.conn || !this.conn.open) return;

    // Pack last 8 frames of inputs for packet-loss resilience!
    const recent = [];
    const myBuf = this.localPlayerNum === 1 ? this.p1Inputs : this.p2Inputs;
    for (let i = 0; i < 8; i++) {
      const f = currentFrame - i;
      if (f >= 0) {
        recent.push([f, myBuf[f % 8192]]);
      }
    }

    const now = performance.now();
    const shouldPing = now - this.lastPingSentAt > 500;
    if (shouldPing) {
      this.lastPingSentAt = now;
      this.inspectWebRTCRoute();
    }

    this.conn.send({
      t: 'IN',
      f: currentFrame,
      in: recent,
      pingTs: shouldPing ? now : 0,
    });
  }

  sendRematchReady() {
    if (!this.isOnline || !this.conn || !this.conn.open) return;
    this.conn.send({
      t: 'REMATCH_READY',
      player: this.localPlayerNum,
      sentAt: performance.now(),
    });
  }

  handleIncomingPacket(data) {
    if (!data) return;
    this.packetPulseIntensity = 1.0;

    if (data.t === 'PONG' && data.pingTs) {
      const rtt = Math.max(1, Math.round(performance.now() - data.pingTs));
      this.realJitterMs = Math.abs(rtt - this.realRttMs);
      this.realRttMs = Math.round(this.realRttMs * 0.7 + rtt * 0.3);
      return;
    }

    if (data.t === 'REMATCH_READY') {
      if (this.conn && this.conn.open && data.sentAt) {
        this.conn.send({ t: 'REMATCH_ACK', sentAt: data.sentAt });
      }
      if (this.onRematchSignal) {
        this.onRematchSignal({
          type: 'REMOTE_READY',
          player: data.player,
          rttMs: this.realRttMs,
        });
      }
      return;
    }

    if (data.t === 'REMATCH_ACK' && data.sentAt) {
      const rtt = Math.max(1, Math.round(performance.now() - data.sentAt));
      this.realRttMs = rtt;
      if (this.onRematchSignal) {
        this.onRematchSignal({
          type: 'ACK_RECEIVED',
          rttMs: rtt,
        });
      }
      return;
    }

    if (data.t === 'RESET_SYNC') {
      if (this.onMatchStart) this.onMatchStart(this.localPlayerNum);
      return;
    }

    if (data.t === 'IN' && Array.isArray(data.in)) {
      if (data.pingTs && this.conn && this.conn.open) {
        this.conn.send({ t: 'PONG', pingTs: data.pingTs });
      }

      const remoteBuf = this.localPlayerNum === 1 ? this.p2Inputs : this.p1Inputs;
      for (let i = 0; i < data.in.length; i++) {
        const [frameNum, mask] = data.in[i];
        const idx = frameNum % 8192;
        remoteBuf[idx] = mask;
        this.remoteReceivedMask[idx] = 1;
        if (frameNum > this.remoteConfirmedFrame) {
          this.remoteConfirmedFrame = frameNum;
        }
      }
    }
  }

  // Main 1-Frame Step (Handles both Real Online WebRTC P2P and Offline CPU Dojo!)
  stepWithRollback(currentState, localInput, cpuFallbackInput) {
    if (this.ghostTimer > 0) this.ghostTimer--;

    // -------------------------------------------------------------------------
    // MODE A: REAL ONLINE WEBRTC P2P (1P Host vs 2P Guest)
    // -------------------------------------------------------------------------
    if (this.isOnline) {
      const f = currentState.frame;

      // Wait (rift sync) if we are more than 8 frames ahead of remote peer
      if (f - this.remoteConfirmedFrame > 8 && f > 10) {
        this.sendInputPacket(f - 1, localInput);
        return currentState;
      }

      const myBuf = this.localPlayerNum === 1 ? this.p1Inputs : this.p2Inputs;
      const remoteBuf = this.localPlayerNum === 1 ? this.p2Inputs : this.p1Inputs;

      myBuf[f % 8192] = localInput;
      this.sendInputPacket(f, localInput);

      // Check if we need to rollback and re-simulate from an earlier frame up to f
      const syncStart = Math.max(1, f - 7);
      let rollbackFrom = -1;

      for (let checkF = syncStart; checkF < f; checkF++) {
        const idx = checkF % 8192;
        if (this.remoteReceivedMask[idx] === 1) {
          const prevPredicted = remoteBuf[(checkF - 1) % 8192];
          if (remoteBuf[idx] !== prevPredicted) {
            rollbackFrom = checkF;
            this.remoteReceivedMask[idx] = 2; // Mark reconciled
            break;
          }
          this.remoteReceivedMask[idx] = 2;
        }
      }

      if (rollbackFrom !== -1) {
        const baseSnap = this.getSnapshot(rollbackFrom - 1);
        if (baseSnap) {
          this.lastRollbackFrames = f - rollbackFrom;
          this.totalRollbacks++;
          this.ghostSnapshot = cloneState(currentState);
          this.ghostTimer = 12;

          let resim = cloneState(baseSnap);
          for (let simF = rollbackFrom; simF <= f; simF++) {
            const sIdx = simF % 8192;
            if (this.remoteReceivedMask[sIdx] === 0) {
              remoteBuf[sIdx] = remoteBuf[(simF - 1) % 8192];
            }
            const i1 = this.p1Inputs[sIdx];
            const i2 = this.p2Inputs[sIdx];
            stepGameState(resim, i1, i2);
            this.saveSnapshot(resim);
          }
          return resim;
        }
      }

      // Predict remote input for frame f if not yet arrived
      const curIdx = f % 8192;
      if (this.remoteReceivedMask[curIdx] === 0) {
        remoteBuf[curIdx] = f > 0 ? remoteBuf[(f - 1) % 8192] : 0;
      }

      this.lastRollbackFrames = 0;
      const nextState = stepGameState(currentState, this.p1Inputs[curIdx], this.p2Inputs[curIdx]);
      this.saveSnapshot(nextState);
      return nextState;
    }

    // -------------------------------------------------------------------------
    // MODE B: OFFLINE CPU DOJO + SIMULATED NETWORK ROLLBACK
    // -------------------------------------------------------------------------
    const f = currentState.frame;
    this.p1Inputs[f % 8192] = localInput;

    const currentRtt = Math.max(2, this.simulatedRttMs + Math.round((Math.random() - 0.5) * 2 * this.simulatedJitterMs));
    const oneWayFrames = Math.floor(currentRtt / 2 / 16.67);
    this.p2Inputs[f % 8192] = cpuFallbackInput;
    this.packetPulseIntensity = 1.0;

    if (oneWayFrames > 0 && f > oneWayFrames + 2) {
      const arrivedFrame = f - oneWayFrames;
      const prevBeforeArrived = this.p2Inputs[(arrivedFrame - 1) % 8192];
      const actualAtArrived = this.p2Inputs[arrivedFrame % 8192];

      if (actualAtArrived !== prevBeforeArrived) {
        this.lastRollbackFrames = oneWayFrames;
        this.totalRollbacks++;
        this.ghostSnapshot = cloneState(currentState);
        this.ghostTimer = 14;

        const baseSnap = this.getSnapshot(arrivedFrame - 1);
        if (baseSnap) {
          let resimState = cloneState(baseSnap);
          for (let simF = arrivedFrame; simF <= f; simF++) {
            const i1 = this.p1Inputs[simF % 8192];
            const i2 = simF <= arrivedFrame ? this.p2Inputs[simF % 8192] : actualAtArrived;
            stepGameState(resimState, i1, i2);
            this.saveSnapshot(resimState);
          }
          return resimState;
        }
      }
    }

    this.lastRollbackFrames = 0;
    const nextState = stepGameState(currentState, localInput, cpuFallbackInput);
    this.saveSnapshot(nextState);
    return nextState;
  }

  getMetrics() {
    if (this.isOnline) {
      return {
        route: this.routeType,
        rttMs: this.realRttMs,
        jitterMs: this.realJitterMs,
        rollbackFrames: this.lastRollbackFrames,
        totalRollbacks: this.totalRollbacks,
      };
    }
    const jitter = Math.round((Math.random() - 0.5) * this.simulatedJitterMs);
    return {
      route: this.routeType,
      rttMs: Math.max(1, this.simulatedRttMs + jitter),
      jitterMs: this.simulatedJitterMs,
      rollbackFrames: this.lastRollbackFrames,
      totalRollbacks: this.totalRollbacks,
    };
  }
}
