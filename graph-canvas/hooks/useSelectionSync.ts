"use client";
import { useEffect, useRef } from "react";
import { useGraphCanvasStore, useRawGraphCanvasStore } from "../store.js";

interface UseSelectionSyncProps {
  controlledSelection: string[] | undefined;
  onSelectionChange?: (ids: string[]) => void;
}

/**
 * Keeps the internal store selection in sync with a controlled `selectedNodeIds`
 * prop, and notifies external listeners whenever the selection changes —
 * whether the graph is controlled or uncontrolled.
 */
// JSON keeps item boundaries intact. A delimiter-only signature makes
// selections such as ["a,b"] and ["a", "b"] indistinguishable, which can
// cause controlled selection updates to be silently skipped.
const getSig = (arr: string[] | undefined) =>
  // oxlint-disable-next-line unicorn/no-array-sort -- sorting a fresh copy keeps the ES2022 runtime target
  JSON.stringify(arr ? [...new Set(arr)].sort() : []);

export function useSelectionSync({
  controlledSelection,
  onSelectionChange,
}: UseSelectionSyncProps) {
  const internalSelection = useGraphCanvasStore((s) => s.selectedNodeIds);
  const store = useRawGraphCanvasStore();

  // Always-current controlled value so Effect 2 can read the latest without
  // having it as a reactive dependency (avoids the two effects fighting).
  const controlledSelectionRef = useRef(controlledSelection);
  controlledSelectionRef.current = controlledSelection;

  const effectiveSelection = controlledSelection ?? internalSelection;

  // 1. Sync controlled props DOWN into the store
  useEffect(() => {
    if (controlledSelection === undefined) return;

    const controlledSig = getSig(controlledSelection);
    const internalSig = getSig(store.getState().selectedNodeIds);

    if (controlledSig !== internalSig) {
      store.getState().setSelection(controlledSelection);
    }
  }, [controlledSelection, store]);

  // 2. Sync internal store changes UP to the parent.
  //
  // Key: we read store.getState() (the *current* store state) rather than
  // the closure-captured `internalSelection`. Because React runs effects in
  // declaration order within a single commit, Effect 1 may have already
  // updated the store by the time Effect 2 runs. Reading the live store
  // ensures we see that update and correctly bail out instead of reverting
  // the parent's change.
  // Signature last handed to the consumer, so the uncontrolled path can tell a
  // real change from a re-run. Seeded with the empty selection's signature so
  // mounting doesn't fire a spurious notification.
  const lastNotifiedRef = useRef(getSig([]));

  useEffect(() => {
    const controlled = controlledSelectionRef.current;
    const currentIds = store.getState().selectedNodeIds;
    const currentSig = getSig(currentIds);

    if (controlled === undefined) {
      // Uncontrolled: compare against what we last reported. Comparing against
      // the controlled value would be wrong here — getSig(undefined) is "",
      // which equals the signature of an empty selection, so clearing the
      // selection would never be reported to the consumer.
      if (lastNotifiedRef.current === currentSig) return;
      lastNotifiedRef.current = currentSig;
      onSelectionChange?.(currentIds);
      return;
    }

    if (getSig(controlled) === currentSig) return;

    onSelectionChange?.(currentIds);

    // In controlled mode the store is a mirror, not a source of truth: an
    // interaction only *proposes* a selection. Snap back to the controlled
    // value so a proposal the parent rejects or clamps isn't retained —
    // otherwise the next shift-click, marquee or group drag would build on a
    // selection the parent never agreed to. If the parent does accept, the
    // prop changes and effect 1 syncs the new value straight back down.
    // (Display is unaffected either way: effectiveSelection prefers the prop.)
    store.getState().setSelection(controlled);
  }, [internalSelection, onSelectionChange, store]);

  return { effectiveSelection };
}
