/** Shortest eager path. Supply importedIds only, never dynamicallyImportedIds. */
export function findStaticPath(graph, entry, target) {
  if (!graph.has(entry)) return null;
  const queue = [[entry]];
  const visited = new Set([entry]);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const path = queue[cursor];
    const current = path.at(-1);
    if (current === target) return path;
    for (const dependency of graph.get(current) ?? []) {
      if (visited.has(dependency)) continue;
      visited.add(dependency);
      queue.push([...path, dependency]);
    }
  }
  return null;
}
