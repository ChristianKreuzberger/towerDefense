export interface InertTarget {
    setAttribute(name: string, value: string): void;
    removeAttribute(name: string): void;
}
export interface InertManager<T extends InertTarget> {
    lock(root: T, siblings: readonly T[]): () => void;
}
export declare function createInertManager<T extends InertTarget>(): InertManager<T>;
export declare const pageInert: InertManager<HTMLElement>;
export declare function lockPageBehind(root: HTMLElement): () => void;
//# sourceMappingURL=modal-inert.d.ts.map