/**
 * Lightweight event emitter for entry mutations.
 *
 * When any useEntries instance creates, updates, or deletes an entry it fires
 * the 'change' event.  Every other useEntries instance (on different screens)
 * listens for this event and refreshes its local data, keeping the entire UI
 * in sync without needing a global context/provider.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

export const entryEvents = {
  /** Subscribe to entry-change events. Returns an unsubscribe function. */
  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },

  /** Notify all subscribers that entries have changed. */
  emit(): void {
    listeners.forEach((fn) => fn());
  },
};
