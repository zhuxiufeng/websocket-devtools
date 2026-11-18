import { describe, it, expect, beforeEach } from 'vitest';
import { useWSStore } from '../src/store/ws-store';
import type { WSConnection } from '../src/types/websocket';

describe('Connections Management & Ghost Pruning Suite', () => {
  beforeEach(() => {
    // Reset store state
    useWSStore.setState({
      frames: [],
      connections: {},
      selectedFrameId: null,
      selectedConnectionId: null,
      hideClosedConnections: false,
    });
  });

  it('purgeInactiveConnections removes all closed connections and retains open ones', () => {
    const connOpen1: WSConnection = {
      id: 'ws://172.18.165.16:7125/websocket?token=live1',
      url: 'ws://172.18.165.16:7125/websocket?token=live1',
      status: 'open',
      frameCount: 50,
      inCount: 40,
      outCount: 10,
      startTime: 1000,
    };

    const connClosed1: WSConnection = {
      id: 'ws://172.18.165.16:7125/websocket?token=dead1',
      url: 'ws://172.18.165.16:7125/websocket?token=dead1',
      status: 'closed',
      frameCount: 0,
      inCount: 0,
      outCount: 0,
      startTime: 900,
      closedAt: 950,
    };

    const connClosed2: WSConnection = {
      id: 'ws://172.18.165.16:7125/websocket?token=dead2',
      url: 'ws://172.18.165.16:7125/websocket?token=dead2',
      status: 'closed',
      frameCount: 12,
      inCount: 10,
      outCount: 2,
      startTime: 800,
      closedAt: 850,
    };

    useWSStore.setState({
      connections: {
        [connOpen1.id]: connOpen1,
        [connClosed1.id]: connClosed1,
        [connClosed2.id]: connClosed2,
      },
      selectedConnectionId: connClosed2.id,
    });

    expect(Object.keys(useWSStore.getState().connections)).toHaveLength(3);
    expect(useWSStore.getState().selectedConnectionId).toBe(connClosed2.id);

    // Act: Purge inactive connections
    useWSStore.getState().purgeInactiveConnections();

    const state = useWSStore.getState();
    const remainingConns = Object.values(state.connections);

    expect(remainingConns).toHaveLength(1);
    expect(remainingConns[0].id).toBe(connOpen1.id);
    expect(remainingConns[0].status).toBe('open');
    // Because selected connection was closed2, it must be reset to null
    expect(state.selectedConnectionId).toBeNull();
  });

  it('purgeInactiveConnections preserves selectedConnectionId if selected is open', () => {
    const connOpen1: WSConnection = {
      id: 'ws://172.18.165.16:7125/websocket?token=live1',
      url: 'ws://172.18.165.16:7125/websocket?token=live1',
      status: 'open',
      frameCount: 5,
      inCount: 5,
      outCount: 0,
      startTime: 1000,
    };

    const connClosed1: WSConnection = {
      id: 'ws://172.18.165.16:7125/websocket?token=dead1',
      url: 'ws://172.18.165.16:7125/websocket?token=dead1',
      status: 'closed',
      frameCount: 0,
      inCount: 0,
      outCount: 0,
      startTime: 900,
    };

    useWSStore.setState({
      connections: {
        [connOpen1.id]: connOpen1,
        [connClosed1.id]: connClosed1,
      },
      selectedConnectionId: connOpen1.id,
    });

    useWSStore.getState().purgeInactiveConnections();

    const state = useWSStore.getState();
    expect(state.selectedConnectionId).toBe(connOpen1.id);
    expect(Object.keys(state.connections)).toEqual([connOpen1.id]);
  });

  it('removeConnection deletes specific connection and updates selectedConnectionId', () => {
    const conn1: WSConnection = {
      id: 'conn-1',
      url: 'ws://localhost:7125/websocket',
      status: 'closed',
      frameCount: 10,
      inCount: 10,
      outCount: 0,
      startTime: 1000,
    };
    const conn2: WSConnection = {
      id: 'conn-2',
      url: 'ws://localhost:7125/websocket',
      status: 'open',
      frameCount: 20,
      inCount: 20,
      outCount: 0,
      startTime: 1000,
    };

    useWSStore.setState({
      connections: { [conn1.id]: conn1, [conn2.id]: conn2 },
      selectedConnectionId: conn1.id,
    });

    useWSStore.getState().removeConnection('conn-1');

    const state = useWSStore.getState();
    expect(state.connections['conn-1']).toBeUndefined();
    expect(state.connections['conn-2']).toBeDefined();
    expect(state.selectedConnectionId).toBeNull();
  });

  it('clearFrames purges closed connections and resets open connection counters', () => {
    const connOpen: WSConnection = {
      id: 'open-1',
      url: 'ws://localhost:7125/websocket',
      status: 'open',
      frameCount: 42,
      inCount: 30,
      outCount: 12,
      startTime: 1000,
    };
    const connClosed: WSConnection = {
      id: 'closed-1',
      url: 'ws://localhost:7125/websocket',
      status: 'closed',
      frameCount: 5,
      inCount: 5,
      outCount: 0,
      startTime: 800,
    };

    useWSStore.setState({
      connections: { [connOpen.id]: connOpen, [connClosed.id]: connClosed },
      selectedConnectionId: connClosed.id,
    });

    useWSStore.getState().clearFrames();

    const state = useWSStore.getState();
    expect(state.frames).toHaveLength(0);
    // connClosed must be purged
    expect(state.connections['closed-1']).toBeUndefined();
    // connOpen must be preserved with frameCount reset to 0
    expect(state.connections['open-1']).toBeDefined();
    expect(state.connections['open-1'].frameCount).toBe(0);
    expect(state.connections['open-1'].inCount).toBe(0);
    expect(state.connections['open-1'].outCount).toBe(0);
    expect(state.selectedConnectionId).toBeNull();
  });

  it('syncConnections rejects new 0-message closed ghost connections', () => {
    const ghostClosed: WSConnection = {
      id: 'ghost-socket-closed',
      url: 'ws://172.18.165.16:7125/websocket?token=failed',
      status: 'closed',
      frameCount: 0,
      inCount: 0,
      outCount: 0,
      startTime: 1000,
    };

    const validOpen: WSConnection = {
      id: 'valid-socket-open',
      url: 'ws://172.18.165.16:7125/websocket?token=success',
      status: 'open',
      frameCount: 0,
      inCount: 0,
      outCount: 0,
      startTime: 1000,
    };

    useWSStore.getState().syncConnections([ghostClosed, validOpen]);

    const conns = useWSStore.getState().connections;
    // Ghost connection was rejected because frameCount === 0 && status === 'closed'
    expect(conns['ghost-socket-closed']).toBeUndefined();
    // Valid open socket is tracked
    expect(conns['valid-socket-open']).toBeDefined();
    expect(conns['valid-socket-open'].status).toBe('open');
  });

  it('hideClosedConnections toggle and setter work correctly', () => {
    expect(useWSStore.getState().hideClosedConnections).toBe(false);

    useWSStore.getState().toggleHideClosedConnections();
    expect(useWSStore.getState().hideClosedConnections).toBe(true);

    useWSStore.getState().toggleHideClosedConnections();
    expect(useWSStore.getState().hideClosedConnections).toBe(false);

    useWSStore.getState().setHideClosedConnections(true);
    expect(useWSStore.getState().hideClosedConnections).toBe(true);
  });
});
