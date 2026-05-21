import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as net from 'net';
import type { AddressInfo } from 'net';
import { GodotRunner } from '../../src/utils/godot-runner.js';
import { encodeFrame, parseFrames } from '../../src/utils/bridge-protocol.js';

interface MockBridge {
  port: number;
  server: net.Server;
  nextFrame(): Promise<string>;
  reply(payload: string): void;
  closePeer(): void;
  shutdown(): Promise<void>;
}

async function startMockBridge(): Promise<MockBridge> {
  let currentPeer: net.Socket | null = null;
  let rxBuffer: Buffer = Buffer.alloc(0);
  const pending: ((frame: string) => void)[] = [];
  const queued: string[] = [];

  const server = net.createServer((socket) => {
    currentPeer = socket;
    rxBuffer = Buffer.alloc(0);
    socket.on('data', (chunk: Buffer) => {
      rxBuffer = Buffer.concat([rxBuffer, chunk]);
      const { frames, remainder } = parseFrames(rxBuffer);
      rxBuffer = remainder;
      for (const frame of frames) {
        const text = frame.toString('utf8');
        const next = pending.shift();
        if (next) next(text);
        else queued.push(text);
      }
    });
    socket.on('error', () => {});
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = (server.address() as AddressInfo).port;

  return {
    port,
    server,
    nextFrame() {
      const queuedFrame = queued.shift();
      if (queuedFrame !== undefined) return Promise.resolve(queuedFrame);
      return new Promise((resolve) => pending.push(resolve));
    },
    reply(payload) {
      if (!currentPeer) throw new Error('No connected peer');
      currentPeer.write(encodeFrame(payload));
    },
    closePeer() {
      if (currentPeer) currentPeer.destroy();
      currentPeer = null;
    },
    shutdown() {
      return new Promise((resolve) => {
        if (currentPeer) currentPeer.destroy();
        server.close(() => resolve());
      });
    },
  };
}

describe('GodotRunner Self-Healing', () => {
  let bridge: MockBridge;
  let runner: GodotRunner;

  beforeEach(async () => {
    bridge = await startMockBridge();
    runner = new GodotRunner({ godotPath: 'godot' });
  });

  afterEach(async () => {
    runner.closeConnection();
    await bridge.shutdown();
    vi.useRealTimers();
  });

  it('scans adjacent ports sequentially on connection failure and heals activeBridgePort', async () => {
    // Configure the runner to start scanning 2 ports below the actual mock bridge port.
    // e.g., if bridge.port is 10002, we set activeBridgePort to 10000.
    // It should fail on 10000, 10001, and succeed on 10002.
    const basePort = bridge.port - 2;
    (runner as unknown as { activeBridgePort: number }).activeBridgePort = basePort;

    const pending = runner.sendCommand('ping');
    const received = await bridge.nextFrame();
    expect(JSON.parse(received)).toEqual({ command: 'ping' });

    bridge.reply('{"status":"pong"}');
    const response = await pending;
    expect(JSON.parse(response)).toEqual({ status: 'pong' });

    // Verify activeBridgePort is updated to the successful port
    expect((runner as unknown as { activeBridgePort: number }).activeBridgePort).toBe(bridge.port);
  });

  it('starts a heartbeat keepalive loop and pings the bridge every 5 seconds', async () => {
    vi.useFakeTimers();

    // First send a command to establish the connection and start the heartbeat
    (runner as unknown as { activeBridgePort: number }).activeBridgePort = bridge.port;
    const initialCmd = runner.sendCommand('ping');

    // Make sure fake timers do not interfere with net socket operations
    vi.advanceTimersByTime(0);

    const received1 = await bridge.nextFrame();
    expect(JSON.parse(received1)).toEqual({ command: 'ping' });
    bridge.reply('{"status":"pong"}');
    await initialCmd;

    // Advance time by 5 seconds to trigger the heartbeat
    const nextHeartbeat = bridge.nextFrame();
    await vi.advanceTimersByTimeAsync(5000);

    const heartbeatFrame = await nextHeartbeat;
    expect(JSON.parse(heartbeatFrame)).toEqual({ command: 'ping' });

    // Reply to keep the heartbeat socket healthy
    bridge.reply('{"status":"pong"}');
  });
});
