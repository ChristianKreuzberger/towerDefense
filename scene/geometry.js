export function cellCenter(x, y, cellSize) {
    return { cx: x * cellSize + cellSize / 2, cy: y * cellSize + cellSize / 2 };
}
