import { create } from 'zustand';

interface SelectionState {
  selected: ReadonlySet<string>;
  /** Last item clicked, the anchor for shift-click ranges. */
  anchor: string | null;
  toggle(id: string): void;
  /** Select everything between the anchor and `id` in the given display order. */
  selectRange(orderedIds: string[], id: string): void;
  clear(): void;
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
  selected: new Set(),
  anchor: null,
  toggle: (id) => {
    const next = new Set(get().selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    set({ selected: next, anchor: id });
  },
  selectRange: (orderedIds, id) => {
    const { anchor, selected } = get();
    const from = anchor ? orderedIds.indexOf(anchor) : -1;
    const to = orderedIds.indexOf(id);
    if (from === -1 || to === -1) {
      get().toggle(id);
      return;
    }
    const next = new Set(selected);
    for (let i = Math.min(from, to); i <= Math.max(from, to); i++) next.add(orderedIds[i]!);
    set({ selected: next, anchor: id });
  },
  clear: () => {
    if (get().selected.size > 0 || get().anchor) set({ selected: new Set(), anchor: null });
  },
}));
