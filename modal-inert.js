export function createInertManager() {
    const holds = new Map();
    const exempt = new Set();
    const active = new Map();
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
            const release = () => {
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
                    }
                    else {
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
export const pageInert = createInertManager();
export function lockPageBehind(root) {
    return pageInert.lock(root, [...(root.parentElement?.children ?? [])]);
}
