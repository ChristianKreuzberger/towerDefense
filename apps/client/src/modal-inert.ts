// Makes the page behind a modal inert. Several dialogs can be open at once (for example Settings during auto-play when
// the match ends), so each lock is counted per element and a dialog's own root is never left inert.
export interface InertTarget {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

export interface InertManager<T extends InertTarget> {
  // Marks every sibling except `root` inert and returns the release function. Calling it twice for one root is a no-op.
  lock(root: T, siblings: readonly T[]): () => void;
}

export function createInertManager<T extends InertTarget>(): InertManager<T> {
  const holds = new Map<T, number>();
  const exempt = new Set<T>();
  const active = new Map<T, () => void>();

  return {
    lock(root, siblings) {
      const existing = active.get(root);
      if (existing) {
        return existing;
      }
      exempt.add(root);
      root.removeAttribute("inert");
      const locked = siblings.filter((node) => node !== root && !exempt.has(node));
      for (const node of locked) {
        holds.set(node, (holds.get(node) ?? 0) + 1);
        node.setAttribute("inert", "");
      }
      const release = (): void => {
        if (active.get(root) !== release) {
          return;
        }
        active.delete(root);
        exempt.delete(root);
        for (const node of locked) {
          const remaining = (holds.get(node) ?? 1) - 1;
          if (remaining <= 0) {
            holds.delete(node);
            node.removeAttribute("inert");
          } else {
            holds.set(node, remaining);
          }
        }
      };
      active.set(root, release);
      return release;
    }
  };
}

// One manager for the page: all dialogs share it.
export const pageInert = createInertManager<HTMLElement>();

export function lockPageBehind(root: HTMLElement): () => void {
  return pageInert.lock(root, [...(root.parentElement?.children ?? [])] as HTMLElement[]);
}
