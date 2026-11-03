import type { WSFrame, FilterCriteria } from '../types/websocket';
import { matchesFilter } from './filter-engine';

export class IncrementalFilterEngine {
  private prevFrames: WSFrame[] = [];
  private prevCriteriaRaw: string = '';
  private prevConnectionId: string | null = null;
  private cachedFiltered: WSFrame[] = [];

  /**
   * Filters frames incrementally when possible.
   * - O(1) pass-through when no filter criteria or connection filter is active.
   * - O(k) incremental append when frames are appended without filter criteria change.
   * - O(N) full re-filter when filter query, regex, or connection filter changes.
   */
  public filter(
    frames: WSFrame[],
    connectionId: string | null,
    criteria: FilterCriteria
  ): WSFrame[] {
    const rawQuery = (criteria?.rawQuery || '').trim();
    const hasActiveFilter = Boolean(connectionId || rawQuery.length > 0);

    // 1. O(1) Pass-through when no filter is active
    if (!hasActiveFilter) {
      this.prevFrames = frames;
      this.prevCriteriaRaw = '';
      this.prevConnectionId = connectionId;
      this.cachedFiltered = [];
      return frames;
    }

    // Check if criteria or connection selection changed
    const criteriaChanged =
      this.prevCriteriaRaw !== rawQuery ||
      this.prevConnectionId !== connectionId;

    const oldFrames = this.prevFrames;
    const oldLen = oldFrames.length;
    const newLen = frames.length;

    // 2. Full scan if criteria changed, cache empty, or buffer cleared/reset
    if (
      criteriaChanged ||
      oldLen === 0 ||
      newLen === 0 ||
      this.cachedFiltered.length === 0
    ) {
      const full = frames.filter((frame) => {
        if (connectionId && frame.connectionId !== connectionId) return false;
        return matchesFilter(frame, criteria);
      });
      this.prevFrames = frames;
      this.prevCriteriaRaw = rawQuery;
      this.prevConnectionId = connectionId;
      this.cachedFiltered = full;
      return full;
    }

    // 3. Same frames reference (no update)
    if (frames === oldFrames) {
      return this.cachedFiltered;
    }

    // 4. Incremental append check
    // Determine how many frames were appended to the end and how many dropped from the front
    const lastOldFrame = oldFrames[oldLen - 1];
    let newFramesSlice: WSFrame[] | null = null;
    let dropCount = 0;

    // Fast O(1) sequence check if seq is present
    if (
      lastOldFrame?.seq !== undefined &&
      frames[newLen - 1]?.seq !== undefined
    ) {
      const seqDelta = frames[newLen - 1].seq! - lastOldFrame.seq;
      if (seqDelta >= 0 && seqDelta < newLen) {
        const candidateIdx = newLen - 1 - seqDelta;
        if (frames[candidateIdx]?.id === lastOldFrame.id) {
          newFramesSlice = frames.slice(candidateIdx + 1);
          dropCount = Math.max(0, oldLen + seqDelta - newLen);
        }
      }
    }

    // Fallback search in recent frames if seq check was inconclusive
    if (!newFramesSlice && lastOldFrame) {
      const searchLimit = Math.min(newLen, 1000);
      for (let i = newLen - 1; i >= newLen - searchLimit; i--) {
        if (frames[i].id === lastOldFrame.id) {
          newFramesSlice = frames.slice(i + 1);
          dropCount = Math.max(0, oldLen + (newLen - 1 - i) - newLen);
          break;
        }
      }
    }

    // If append detection failed (e.g. bulk replacement or jump), fallback to full scan
    if (!newFramesSlice) {
      const full = frames.filter((frame) => {
        if (connectionId && frame.connectionId !== connectionId) return false;
        return matchesFilter(frame, criteria);
      });
      this.prevFrames = frames;
      this.prevCriteriaRaw = rawQuery;
      this.prevConnectionId = connectionId;
      this.cachedFiltered = full;
      return full;
    }

    // Process dropped frames from cachedFiltered head
    let filteredList = this.cachedFiltered;
    if (dropCount > 0 && frames.length > 0) {
      const minSeq = frames[0].seq;
      if (minSeq !== undefined) {
        let dropIndex = 0;
        while (
          dropIndex < filteredList.length &&
          (filteredList[dropIndex].seq ?? 0) < minSeq
        ) {
          dropIndex++;
        }
        if (dropIndex > 0) {
          filteredList = filteredList.slice(dropIndex);
        }
      } else {
        const minTs = frames[0].timestamp;
        let dropIndex = 0;
        while (
          dropIndex < filteredList.length &&
          filteredList[dropIndex].timestamp < minTs
        ) {
          dropIndex++;
        }
        if (dropIndex > 0) {
          filteredList = filteredList.slice(dropIndex);
        }
      }
    }

    // Filter ONLY the newly added frames (O(k))
    if (newFramesSlice.length > 0) {
      const newlyMatched: WSFrame[] = [];
      for (let i = 0; i < newFramesSlice.length; i++) {
        const f = newFramesSlice[i];
        if (connectionId && f.connectionId !== connectionId) continue;
        if (matchesFilter(f, criteria)) {
          newlyMatched.push(f);
        }
      }
      filteredList = newlyMatched.length > 0 ? filteredList.concat(newlyMatched) : filteredList;
    }

    this.prevFrames = frames;
    this.prevCriteriaRaw = rawQuery;
    this.prevConnectionId = connectionId;
    this.cachedFiltered = filteredList;
    return filteredList;
  }

  public reset(): void {
    this.prevFrames = [];
    this.prevCriteriaRaw = '';
    this.prevConnectionId = null;
    this.cachedFiltered = [];
  }
}
