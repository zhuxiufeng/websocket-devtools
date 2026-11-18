import { describe, it, expect, beforeEach } from 'vitest';
import { useWSStore } from '../src/store/ws-store';
import type { WSFrame } from '../src/types/websocket';

describe('Auto-Scroll Hijacking & Scroll Lock Verification Suite', () => {
  beforeEach(() => {
    useWSStore.getState().clearFrames();
    useWSStore.getState().setIsAutoScrollPaused(false);
    useWSStore.getState().resetUnseenCount();
    useWSStore.getState().setFollowLatestInspector(false);
  });

  describe('1. High-frequency streaming with auto-scroll paused', () => {
    it('does not increment unseenNewFramesCount when auto-scroll is active', () => {
      const store = useWSStore.getState();
      expect(store.isAutoScrollPaused).toBe(false);
      expect(store.unseenNewFramesCount).toBe(0);

      store.addFramesBatch([
        { id: 'f-1', connectionId: 'ws-1', timestamp: 1000, direction: 'in', payload: '{"msg":1}' },
        { id: 'f-2', connectionId: 'ws-1', timestamp: 1001, direction: 'out', payload: '{"msg":2}' },
      ]);

      expect(useWSStore.getState().unseenNewFramesCount).toBe(0);
      expect(useWSStore.getState().frames.length).toBe(2);
    });

    it('increments unseenNewFramesCount on each batch when auto-scroll is paused', () => {
      const store = useWSStore.getState();
      // User scrolls up to inspect history -> auto-scroll pauses
      store.setIsAutoScrollPaused(true);
      expect(useWSStore.getState().isAutoScrollPaused).toBe(true);

      // Batch 1: 10 frames
      const batch1 = Array.from({ length: 10 }, (_, i) => ({
        id: `f-batch1-${i}`,
        connectionId: 'ws-1',
        timestamp: 1000 + i,
        direction: 'in' as const,
        payload: JSON.stringify({ index: i }),
      }));
      store.addFramesBatch(batch1);

      expect(useWSStore.getState().unseenNewFramesCount).toBe(10);
      expect(useWSStore.getState().isAutoScrollPaused).toBe(true);

      // Batch 2: High-frequency burst of 50 frames
      const batch2 = Array.from({ length: 50 }, (_, i) => ({
        id: `f-batch2-${i}`,
        connectionId: 'ws-1',
        timestamp: 1100 + i,
        direction: 'in' as const,
        payload: JSON.stringify({ index: i + 10 }),
      }));
      store.addFramesBatch(batch2);

      expect(useWSStore.getState().unseenNewFramesCount).toBe(60);
      expect(useWSStore.getState().isAutoScrollPaused).toBe(true);
    });

    it('handles rapid ticks without race conditions in unseen frame counter', () => {
      const store = useWSStore.getState();
      store.setIsAutoScrollPaused(true);

      // Simulate 100 rapid stream ticks of 5 frames each (500 frames)
      for (let tick = 0; tick < 100; tick++) {
        const tickFrames = Array.from({ length: 5 }, (_, i) => ({
          id: `tick-${tick}-${i}`,
          connectionId: 'ws-1',
          timestamp: 2000 + tick * 10 + i,
          direction: 'in' as const,
          payload: `{"tick":${tick},"i":${i}}`,
        }));
        store.addFramesBatch(tickFrames);
      }

      expect(useWSStore.getState().unseenNewFramesCount).toBe(500);
      expect(useWSStore.getState().frames.length).toBe(500);
      expect(useWSStore.getState().isAutoScrollPaused).toBe(true);
    });
  });

  describe('2. Resuming auto-scroll & clearing unseen frame count', () => {
    it('clears unseenNewFramesCount and unpauses auto-scroll via resetUnseenCount()', () => {
      const store = useWSStore.getState();
      store.setIsAutoScrollPaused(true);
      store.addFramesBatch([
        { id: 'f-1', connectionId: 'ws-1', timestamp: 1000, direction: 'in', payload: '{}' },
        { id: 'f-2', connectionId: 'ws-1', timestamp: 1001, direction: 'in', payload: '{}' },
      ]);
      expect(useWSStore.getState().unseenNewFramesCount).toBe(2);

      store.resetUnseenCount();
      expect(useWSStore.getState().unseenNewFramesCount).toBe(0);
      expect(useWSStore.getState().isAutoScrollPaused).toBe(false);

      // Subsequent frames do not increment unseen counter
      store.addFramesBatch([
        { id: 'f-3', connectionId: 'ws-1', timestamp: 1002, direction: 'in', payload: '{}' },
      ]);
      expect(useWSStore.getState().unseenNewFramesCount).toBe(0);
    });

    it('dispatches lastScrollRequest = { target: "latest" } and resumes live auto-scroll on jumpToLatestFrame()', () => {
      const store = useWSStore.getState();
      store.addFramesBatch([
        { id: 'f-1', connectionId: 'ws-1', timestamp: 1000, direction: 'in', payload: '{}' },
        { id: 'f-2', connectionId: 'ws-1', timestamp: 1001, direction: 'in', payload: '{}' },
      ]);

      store.setIsAutoScrollPaused(true);
      store.addFramesBatch([
        { id: 'f-3', connectionId: 'ws-1', timestamp: 1002, direction: 'in', payload: '{}' },
        { id: 'f-4', connectionId: 'ws-1', timestamp: 1003, direction: 'in', payload: '{}' },
      ]);
      expect(useWSStore.getState().unseenNewFramesCount).toBe(2);

      const beforeTime = Date.now();
      store.jumpToLatestFrame();

      const stateAfter = useWSStore.getState();
      expect(stateAfter.isAutoScrollPaused).toBe(false);
      expect(stateAfter.unseenNewFramesCount).toBe(0);
      expect(stateAfter.selectedFrameId).toBe('f-4');
      expect(stateAfter.lastScrollRequest).not.toBeNull();
      expect(stateAfter.lastScrollRequest?.target).toBe('latest');
      expect(stateAfter.lastScrollRequest?.timestamp).toBeGreaterThanOrEqual(beforeTime);
    });

    it('dispatches lastScrollRequest = { target: "first" } and pauses auto-scroll on jumpToFirstFrame()', () => {
      const store = useWSStore.getState();
      store.addFramesBatch([
        { id: 'f-1', connectionId: 'ws-1', timestamp: 1000, direction: 'in', payload: '{}' },
        { id: 'f-2', connectionId: 'ws-1', timestamp: 1001, direction: 'in', payload: '{}' },
        { id: 'f-3', connectionId: 'ws-1', timestamp: 1002, direction: 'in', payload: '{}' },
      ]);

      const beforeTime = Date.now();
      store.jumpToFirstFrame();

      const stateAfter = useWSStore.getState();
      expect(stateAfter.isAutoScrollPaused).toBe(true);
      expect(stateAfter.selectedFrameId).toBe('f-1');
      expect(stateAfter.lastScrollRequest).not.toBeNull();
      expect(stateAfter.lastScrollRequest?.target).toBe('first');
      expect(stateAfter.lastScrollRequest?.timestamp).toBeGreaterThanOrEqual(beforeTime);

      // Now incoming frames should accumulate unseen counter
      store.addFramesBatch([
        { id: 'f-4', connectionId: 'ws-1', timestamp: 1003, direction: 'in', payload: '{}' },
      ]);
      expect(useWSStore.getState().unseenNewFramesCount).toBe(1);
    });
  });

  describe('3. Historical frame selection stability under active streaming', () => {
    it('preserves historical selectedFrameId during streaming when auto-scroll is paused', () => {
      const store = useWSStore.getState();

      // Initial buffer of 20 frames
      const initial = Array.from({ length: 20 }, (_, i) => ({
        id: `f-${i}`,
        connectionId: 'ws-1',
        timestamp: 1000 + i,
        direction: 'in' as const,
        payload: JSON.stringify({ index: i }),
      }));
      store.addFramesBatch(initial);

      // User selects a historical frame (e.g., f-5)
      store.setSelectedFrameId('f-5');
      store.setIsAutoScrollPaused(true);

      expect(useWSStore.getState().selectedFrameId).toBe('f-5');

      // Now stream 50 new frames in 5 bursts
      for (let burst = 0; burst < 5; burst++) {
        const streamBurst = Array.from({ length: 10 }, (_, i) => ({
          id: `stream-${burst}-${i}`,
          connectionId: 'ws-1',
          timestamp: 2000 + burst * 10 + i,
          direction: 'in' as const,
          payload: JSON.stringify({ burst, i }),
        }));
        store.addFramesBatch(streamBurst);

        // Verification: selectedFrameId must remain 'f-5'
        expect(useWSStore.getState().selectedFrameId).toBe('f-5');
      }

      expect(useWSStore.getState().frames.length).toBe(70);
      expect(useWSStore.getState().selectedFrameId).toBe('f-5');
      expect(useWSStore.getState().unseenNewFramesCount).toBe(50);
    });

    it('does NOT override selected historical frame even if followLatestInspector was active when paused', () => {
      const store = useWSStore.getState();
      store.addFramesBatch([
        { id: 'f-1', connectionId: 'ws-1', timestamp: 1000, direction: 'in', payload: '{}' },
        { id: 'f-2', connectionId: 'ws-1', timestamp: 1001, direction: 'in', payload: '{}' },
      ]);

      // User selects historical frame f-1
      store.setSelectedFrameId('f-1');
      // Auto-scroll is paused
      store.setIsAutoScrollPaused(true);
      // Even if followLatestInspector is toggled on, if auto-scroll is paused,
      // incoming frames must not override the user-selected historical frame.
      store.setFollowLatestInspector(true);

      store.addFramesBatch([
        { id: 'f-3', connectionId: 'ws-1', timestamp: 1002, direction: 'in', payload: '{}' },
        { id: 'f-4', connectionId: 'ws-1', timestamp: 1003, direction: 'in', payload: '{}' },
      ]);

      expect(useWSStore.getState().selectedFrameId).toBe('f-1');
    });

    it('pauses auto-scroll when user moves to previous frame via selectAdjacentFrame(-1)', () => {
      const store = useWSStore.getState();
      store.addFramesBatch([
        { id: 'f-1', connectionId: 'ws-1', timestamp: 1000, direction: 'in', payload: '{}' },
        { id: 'f-2', connectionId: 'ws-1', timestamp: 1001, direction: 'in', payload: '{}' },
        { id: 'f-3', connectionId: 'ws-1', timestamp: 1002, direction: 'in', payload: '{}' },
      ]);
      store.setSelectedFrameId('f-3');
      expect(useWSStore.getState().isAutoScrollPaused).toBe(false);

      // User presses ArrowUp / k
      store.selectAdjacentFrame(-1);
      expect(useWSStore.getState().selectedFrameId).toBe('f-2');
      expect(useWSStore.getState().isAutoScrollPaused).toBe(true);
    });

    it('pauses auto-scroll when user jumps to RPC paired peer via jumpToFrameId', () => {
      const store = useWSStore.getState();
      store.addFramesBatch([
        { id: 'req-1', connectionId: 'ws-1', timestamp: 1000, direction: 'out', payload: '{"id":1,"method":"foo"}' },
        { id: 'res-1', connectionId: 'ws-1', timestamp: 1050, direction: 'in', payload: '{"id":1,"result":"bar"}' },
      ]);
      expect(useWSStore.getState().isAutoScrollPaused).toBe(false);

      // Jump to req-1
      store.jumpToFrameId('req-1');
      expect(useWSStore.getState().selectedFrameId).toBe('req-1');
      expect(useWSStore.getState().isAutoScrollPaused).toBe(true);
    });
  });

  describe('4. Scroll hijacking prevention simulation logic', () => {
    it('simulates user scroll-up intent triggering pause', () => {
      let isAutoScrollPaused = false;
      let unseenNewFramesCount = 0;

      // Wheel up event simulation (deltaY < 0)
      const onWheel = (deltaY: number) => {
        if (deltaY < 0) {
          isAutoScrollPaused = true;
        }
      };

      // Ingestion event simulation
      const onNewFrames = (count: number) => {
        if (isAutoScrollPaused) {
          unseenNewFramesCount += count;
        }
      };

      // User wheels up
      onWheel(-120);
      expect(isAutoScrollPaused).toBe(true);

      // Streaming continues
      onNewFrames(25);
      expect(unseenNewFramesCount).toBe(25);

      // Follow latest clicked
      const onFollowLatestClick = () => {
        isAutoScrollPaused = false;
        unseenNewFramesCount = 0;
      };

      onFollowLatestClick();
      expect(isAutoScrollPaused).toBe(false);
      expect(unseenNewFramesCount).toBe(0);

      // Further streaming
      onNewFrames(10);
      expect(unseenNewFramesCount).toBe(0);
    });

    it('does not reset isAutoScrollPaused simply because a programmatic scroll touched bottom', () => {
      let isAutoScrollPaused = true;
      let isProgrammaticScroll = true;

      // Programmatic scroll finishes at bottom
      const onScroll = (isAtBottom: boolean) => {
        // If the scroll was programmatic (auto-scroll or jump), it must not reset user-pause!
        if (isProgrammaticScroll) {
          return;
        }
        if (isAtBottom && isAutoScrollPaused) {
          isAutoScrollPaused = false;
        }
      };

      onScroll(true);
      // Must remain paused because scroll was programmatic!
      expect(isAutoScrollPaused).toBe(true);
    });

    it('simulates scrollbar upward drag pausing auto-scroll immediately', () => {
      let isAutoScrollPaused = false;
      let isDraggingScrollbar = false;
      let pointerStartY = 0;
      let initialScrollTop = 500;

      // Pointer down on scrollbar
      const onPointerDown = (clientX: number, containerRight: number, clientY: number) => {
        if (clientX >= containerRight - 15) {
          isDraggingScrollbar = true;
          pointerStartY = clientY;
        }
      };

      // Pointer move
      const onPointerMove = (clientY: number, currentScrollTop: number) => {
        if (!isDraggingScrollbar) return;
        // Dragging upward: clientY < pointerStartY or currentScrollTop < initialScrollTop
        if (clientY < pointerStartY || currentScrollTop < initialScrollTop) {
          isAutoScrollPaused = true;
        }
      };

      onPointerDown(590, 600, 300);
      expect(isDraggingScrollbar).toBe(true);

      // Drag up to clientY = 250
      onPointerMove(250, 400);
      expect(isAutoScrollPaused).toBe(true);
    });

    it('simulates keyboard navigation (PageUp / Home / ArrowUp) triggering pause', () => {
      let isAutoScrollPaused = false;

      const onKeyDown = (key: string) => {
        if (key === 'PageUp' || key === 'Home' || key === 'ArrowUp') {
          isAutoScrollPaused = true;
        }
      };

      onKeyDown('PageUp');
      expect(isAutoScrollPaused).toBe(true);

      isAutoScrollPaused = false;
      onKeyDown('Home');
      expect(isAutoScrollPaused).toBe(true);

      isAutoScrollPaused = false;
      onKeyDown('ArrowUp');
      expect(isAutoScrollPaused).toBe(true);
    });

    it('resumes auto-scroll ONLY when user intentionally scrolls DOWN to the bottom', () => {
      let isAutoScrollPaused = true;
      let unseenCount = 5;

      const handleUserScroll = (scrollDelta: number, isAtBottom: boolean) => {
        const isScrollingUp = scrollDelta < -1;
        const isScrollingDown = scrollDelta > 1;

        if (isScrollingUp) {
          isAutoScrollPaused = true;
        } else if (isScrollingDown && isAtBottom) {
          isAutoScrollPaused = false;
          unseenCount = 0;
        }
      };

      // User scrolls up: remains paused
      handleUserScroll(-20, false);
      expect(isAutoScrollPaused).toBe(true);

      // User scrolls up while within 10px of bottom: MUST NOT UNPAUSE! (Fixes root cause 2)
      handleUserScroll(-10, true);
      expect(isAutoScrollPaused).toBe(true);

      // User scrolls down but is not yet at bottom: remains paused
      handleUserScroll(30, false);
      expect(isAutoScrollPaused).toBe(true);

      // User scrolls down and reaches the bottom: successfully unpauses!
      handleUserScroll(30, true);
      expect(isAutoScrollPaused).toBe(false);
      expect(unseenCount).toBe(0);
    });
  });
});
