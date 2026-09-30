export const TOPICS = { People: '#a78bfa', Places: '#62c9eb', Science: '#a8d780', Culture: '#efad79', Other: '#8192ab' };
export const key = title => title.replaceAll('_', ' ').normalize('NFC').trim();

export function topicFor(categories) {
  const text = categories.join(' ').toLowerCase();
  if (/births|deaths|living people|actors|actresses|politicians|singers|players|people from|musicians|presidents|monarchs/.test(text)) return 'People';
  if (/countries|cities|geography|geographic|territories|settlements|continents|islands|rivers|mountains/.test(text)) return 'Places';
  if (/physics|biology|chemistry|astronomy|scientific|science|technology|mathematics|diseases|species|computing|planets/.test(text)) return 'Science';
  if (/films|television|albums|music|novels|games|medal tables|sports|sporting|literature|art|entertainment|festivals/.test(text)) return 'Culture';
  return 'Other';
}

// Keep every real directed edge. A separate undirected spanning forest controls layout.
// Earlier edges stay in the forest; a newly arriving bridge may join two components.
export class ArticleGraph {
  constructor() { this.nodes = new Map(); this.aliases = new Map(); this.edges = new Map(); this.forest = []; this.roots = []; }
  add(article) {
    const id = String(article.pageid);
    const old = this.nodes.get(id);
    this.aliases.set(key(article.title), id);
    for (const alias of article.aliases || []) this.aliases.set(key(alias), id);
    if (old) { old.views += article.views; old.rank = Math.min(old.rank, article.rank); this.rebuild(); return null; }
    const node = { ...article, id, topic: topicFor(article.categories), links: new Set(article.links.map(key)), x: 0, y: 0, tx: 0, ty: 0, children: [] };
    this.nodes.set(id, node);
    this.rebuild();
    return node;
  }
  rebuild() {
    for (const n of this.nodes.values()) for (const title of n.links) {
      const target = this.aliases.get(title);
      if (target && target !== n.id) {
        const edgeId = `${n.id}>${target}`;
        if (!this.edges.has(edgeId)) this.edges.set(edgeId, { source: n.id, target });
      }
    }
    const parents = new Map([...this.nodes.keys()].map(id => [id, id]));
    const find = id => { let root = id; while (parents.get(root) !== root) root = parents.get(root); while (id !== root) { const next = parents.get(id); parents.set(id, root); id = next; } return root; };
    this.forest = [];
    const adjacency = new Map([...this.nodes.keys()].map(id => [id, []]));
    for (const edge of this.edges.values()) {
      const a = find(edge.source), b = find(edge.target);
      if (a === b) continue;
      parents.set(a, b); this.forest.push(edge);
      adjacency.get(edge.source).push(edge.target); adjacency.get(edge.target).push(edge.source);
    }
    const visited = new Set(); this.roots = [];
    const sorted = [...this.nodes.values()].sort((a, b) => a.rank - b.rank);
    for (const n of sorted) { n.children = []; n.parent = null; }
    for (const n of sorted) {
      if (visited.has(n.id)) continue;
      this.roots.push(n); visited.add(n.id);
      const queue = [n];
      for (let i = 0; i < queue.length; i++) {
        const current = queue[i];
        for (const id of adjacency.get(current.id).sort((a, b) => this.nodes.get(a).rank - this.nodes.get(b).rank)) {
          if (visited.has(id)) continue;
          const child = this.nodes.get(id); visited.add(id); child.parent = current.id; current.children.push(child); queue.push(child);
        }
      }
    }
    this.layout();
  }
  layout() {
    const measure = node => { node.weight = node.children.length ? node.children.reduce((total, child) => total + measure(child), 0) : 1; return node.weight; };
    const leaves = this.roots.reduce((total, root) => total + measure(root), 0);
    // Widen each ring for large trees rather than letting adjacent leaves overlap.
    const baseRadius = Math.max(155, leaves * 9);
    const place = (n, begin, end, depth) => {
      const angle = (begin + end) / 2 - Math.PI / 2;
      const radius = baseRadius + (depth - 1) * 150;
      n.tx = Math.cos(angle) * radius; n.ty = Math.sin(angle) * radius;
      if (!n.placed) { const p = this.nodes.get(n.parent); n.x = p?.x || n.tx * .86; n.y = p?.y || n.ty * .86; n.placed = true; }
      let cursor = begin;
      for (const child of n.children) { const size = (end - begin) * child.weight / n.weight; place(child, cursor, cursor + size, depth + 1); cursor += size; }
    };
    let cursor = 0;
    for (const root of this.roots) { const size = Math.PI * 2 * root.weight / Math.max(1, leaves); place(root, cursor, cursor + size, 1); cursor += size; }
  }
  connections(id) { return [...this.edges.values()].filter(e => e.source === id || e.target === id); }
}
