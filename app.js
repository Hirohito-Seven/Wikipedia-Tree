import { ArticleGraph, TOPICS } from './graph.js';
import { WikipediaClient } from './wiki.js';
const $ = id => document.getElementById(id);
const canvas = $('tree-canvas'), ctx = canvas.getContext('2d');
let graph = new ArticleGraph(), selected = null, hovered = null;
let width = 800, height = 600, camera = { x: 0, y: 0, scale: 1 }, userMoved = false;
let session = null, paused = false, wake = null, running = false, total = 100, ranking = null, cursor = 0, skipped = 0, animation = null;
const format = value => new Intl.NumberFormat('en', { notation: value >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value);
const radius = node => 5 + Math.min(9, Math.max(0, Math.log10(Math.max(1, node.views)) - 3) * 3);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

function setStatus(message) { $('status').textContent = message; }
function setError(message = '') { $('error').textContent = message; $('error').hidden = !message; }
function updateControls() {
  $('start-button').disabled = running;
  $('start-button').innerHTML = '<span aria-hidden="true">✦</span> ' + (ranking && graph.nodes.size < total ? 'Continue growing' : 'Grow tree');
  $('article-limit').disabled = running;
  $('pause-button').disabled = !running; $('pause-button').textContent = paused ? 'Resume' : 'Pause';
  $('stop-button').disabled = !running; $('reset-button').disabled = !ranking && !graph.nodes.size && !running;
}
function stats() {
  const count = graph.nodes.size;
  $('node-count').textContent = format(count); $('edge-count').textContent = format(graph.edges.size); $('branch-count').textContent = format(graph.roots.length);
  $('list-count').textContent = count; $('run-count').textContent = `${count} / ${total}`;
  $('progress').max = total; $('progress').value = count;
  $('map-empty').hidden = count > 0; $('article-empty').hidden = count > 0;
  canvas.setAttribute('aria-label', `Wikipedia tree with ${count} articles, ${graph.edges.size} hyperlinks and ${graph.roots.length} connected groups. Drag to pan, scroll to zoom. Select articles using the processed articles list.`);
}
function addListNode(node) {
  const li = document.createElement('li'), button = document.createElement('button');
  button.type = 'button'; button.dataset.id = node.id; button.setAttribute('aria-pressed', 'false'); button.title = node.title;
  const rank = document.createElement('span'); rank.className = 'article-rank'; rank.textContent = `#${node.rank}`;
  const dot = document.createElement('span'); dot.className = 'article-dot'; dot.style.background = TOPICS[node.topic];
  const title = document.createElement('span'); title.className = 'article-name'; title.textContent = node.title;
  button.append(rank, dot, title); button.addEventListener('click', () => { selectNode(node.id); focusNode(node); }); li.append(button); $('article-list').append(li);
  if (!selected) selectNode(node.id);
}
function el(tag, text, className) { const element = document.createElement(tag); if (text) element.textContent = text; if (className) element.className = className; return element; }
function selectNode(id) {
  selected = id; renderDetails();
  for (const button of $('article-list').querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.id === id));
  scheduleDraw();
}
function renderDetails() {
  const node = graph.nodes.get(selected); if (!node) return;
  $('detail-placeholder').hidden = true; $('details-panel').setAttribute('aria-labelledby', 'selected-article-title'); const panel = $('article-details'); panel.hidden = false; panel.replaceChildren();
  const tag = el('span', node.topic, 'detail-tag'); tag.style.color = TOPICS[node.topic];
  const title = el('h2', node.title, 'detail-title'); title.id = 'selected-article-title';
  const meta = el('div', '', 'article-meta');
  for (const [value, label] of [[`#${node.rank}`, 'daily rank'], [format(node.views), 'daily views']]) { const field = el('div'); field.append(el('strong', value), el('span', label)); meta.append(field); }
  panel.append(tag, title, meta, el('p', node.extract, 'detail-intro'));
  const link = el('a', 'Read on Wikipedia', 'read-link'); link.href = node.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; panel.append(link);
  const connections = graph.connections(node.id); panel.append(el('h3', `Connections in this tree (${connections.length})`));
  const list = el('div', '', 'connection-list');
  const byNeighbor = new Map();
  for (const edge of connections) { const other = edge.source === node.id ? edge.target : edge.source; const info = byNeighbor.get(other) || { incoming: false, outgoing: false }; info.outgoing ||= edge.source === node.id; info.incoming ||= edge.target === node.id; byNeighbor.set(other, info); }
  for (const [otherId, info] of byNeighbor) { const other = graph.nodes.get(otherId); const button = el('button', `${other.title} · ${info.incoming && info.outgoing ? 'both directions' : info.outgoing ? 'linked from here' : 'links here'}`); button.type = 'button'; button.addEventListener('click', () => { selectNode(otherId); focusNode(other); }); list.append(button); }
  if (!connections.length) list.append(el('p', 'No hyperlinks to other processed articles yet.', 'selection-note'));
  panel.append(list);
  if (node.categories.length) { panel.append(el('h3', 'Wikipedia categories')); const tags = el('div', '', 'category-tags'); for (const category of node.categories.slice(0, 12)) tags.append(el('span', category)); panel.append(tags); if (node.categories.length > 12) panel.append(el('p', `+ ${node.categories.length - 12} more categories on Wikipedia`, 'selection-note')); }
}
async function gate() {
  while (paused) await new Promise(resolve => { wake = resolve; });
  session?.signal.throwIfAborted();
}
function resume() { paused = false; wake?.(); wake = null; updateControls(); }
function abortRun() { session?.abort(); resume(); }
function reset() {
  abortRun(); session = null; running = false; ranking = null; cursor = 0; skipped = 0; graph = new ArticleGraph(); selected = hovered = null; camera = {x:0,y:0,scale:1}; userMoved = false;
  $('article-list').replaceChildren(); $('article-details').hidden = true; $('article-details').replaceChildren(); $('detail-placeholder').hidden = false; $('details-panel').setAttribute('aria-labelledby', 'detail-title'); $('hover-label').hidden = true;
  $('ranking-date').textContent = 'Daily popularity · live API'; $('run-label').textContent = 'Ready to explore'; setError(); setStatus('Choose a count, then grow your tree.'); updateControls(); stats(); scheduleDraw();
}
async function grow() {
  if (running) return;
  const requested = Number($('article-limit').value);
  if (!Number.isInteger(requested) || requested < 1 || requested > 1000) { setError('Choose a whole number from 1 to 1,000.'); return; }
  if (ranking && (requested !== total || graph.nodes.size >= total)) reset();
  total = requested; session = new AbortController(); const currentSession = session;
  const client = new WikipediaClient({ signal: session.signal, beforeRequest: gate });
  running = true; paused = false; setError(); updateControls(); stats();
  try {
    if (!ranking) {
      $('run-label').textContent = 'Finding popular articles'; setStatus('Loading the latest available daily ranking…');
      ranking = await client.ranking(); currentSession.signal.throwIfAborted();
      $('ranking-date').textContent = `${ranking.date} · daily pageviews (UTC)`;
      $('limit-note').textContent = `1–1,000 · ${ranking.articles.length} ranked candidates available`;
    }
    while (graph.nodes.size < total && cursor < ranking.articles.length) {
      await gate(); currentSession.signal.throwIfAborted();
      const candidate = ranking.articles[cursor];
      $('run-label').textContent = 'Growing your tree'; setStatus(`Processing #${candidate.rank}: ${candidate.title}…`);
      const article = await client.article(candidate); await gate(); currentSession.signal.throwIfAborted(); cursor++;
      if (!article) { skipped++; continue; }
      const node = graph.add(article);
      if (node) addListNode(node); else skipped++;
      stats(); if (selected) renderDetails();
      if (!userMoved) fitTree(false); scheduleDraw();
      await client.delay(reducedMotion ? 0 : 200);
    }
    $('run-label').textContent = 'Tree complete';
    const suffix = skipped ? ` ${skipped} non-article or duplicate pages skipped.` : '';
    setStatus(graph.nodes.size < total ? `Ranking exhausted: ${graph.nodes.size} articles available.${suffix}` : `${graph.nodes.size} articles processed. Select any node to explore.${suffix}`);
  } catch (error) {
    if (currentSession !== session) return;
    if (currentSession.signal.aborted) { $('run-label').textContent = 'Stopped'; setStatus('Your tree is preserved. Continue growing to resume.'); }
    else { console.error('Wikipedia Tree request failed:', error); $('run-label').textContent = 'Could not continue'; setError(error instanceof TypeError ? 'Could not reach Wikipedia. Check your connection and try again. Your tree is preserved.' : `${error.message} Your tree is preserved; use Continue growing to retry.`); }
  } finally { if (currentSession === session) { running = false; resume(); updateControls(); } }
}
$('grow-form').addEventListener('submit', event => { event.preventDefault(); grow(); });
$('article-limit').addEventListener('input', () => { if (!running) { $('run-count').textContent = `${graph.nodes.size} / ${$('article-limit').value || '—'}`; } });
$('pause-button').addEventListener('click', () => { if (paused) { resume(); $('run-label').textContent = 'Growing your tree'; setStatus('Resuming…'); } else { paused = true; $('run-label').textContent = 'Paused'; setStatus('Paused. Explore the tree, then resume when ready.'); updateControls(); } });
$('stop-button').addEventListener('click', abortRun); $('reset-button').addEventListener('click', reset);
$('cross-links').addEventListener('change', scheduleDraw);

function fitTree(manual = true) {
  if (!graph.nodes.size) { camera = {x:0,y:0,scale:1}; scheduleDraw(); return; }
  let minX = 0, maxX = 0, minY = 0, maxY = 0;
  for (const n of graph.nodes.values()) { minX = Math.min(minX, n.tx); maxX = Math.max(maxX, n.tx); minY = Math.min(minY, n.ty); maxY = Math.max(maxY, n.ty); }
  camera.scale = Math.min(1.6, Math.max(.015, Math.min((width - 130) / Math.max(100, maxX - minX), (height - 150) / Math.max(100, maxY - minY))));
  camera.x = -(minX + maxX) / 2 * camera.scale; camera.y = -(minY + maxY) / 2 * camera.scale;
  if (manual) userMoved = true; scheduleDraw();
}
function focusNode(node) { userMoved = true; camera.scale = Math.max(camera.scale, .8); camera.x = -node.tx * camera.scale; camera.y = -node.ty * camera.scale; scheduleDraw(); }
function zoom(factor, x = width / 2, y = height / 2) {
  const old = camera.scale, next = Math.max(.015, Math.min(5, old * factor));
  camera.x = (camera.x - (x - width / 2)) * next / old + x - width / 2;
  camera.y = (camera.y - (y - height / 2)) * next / old + y - height / 2;
  camera.scale = next; userMoved = true; scheduleDraw();
}
$('fit-button').addEventListener('click', () => fitTree()); $('zoom-in').addEventListener('click', () => zoom(1.25)); $('zoom-out').addEventListener('click', () => zoom(.8));
function screen(node) { return {x:width / 2 + camera.x + node.x * camera.scale, y:height / 2 + camera.y + node.y * camera.scale}; }
function nodeAt(x, y) {
  let closest = null, distance = Infinity;
  for (const node of graph.nodes.values()) { const p = screen(node); const d = Math.hypot(p.x - x, p.y - y); if (d < Math.max(8, radius(node) * camera.scale + 4) && d < distance) { closest = node; distance = d; } }
  return closest;
}
let pointers = new Map(), drag = null, moved = false, pinch = null;
canvas.addEventListener('pointerdown', event => {
  canvas.setPointerCapture(event.pointerId); pointers.set(event.pointerId, {x:event.offsetX,y:event.offsetY});
  if (pointers.size === 2) { const [a,b] = [...pointers.values()]; pinch = Math.hypot(a.x-b.x,a.y-b.y); drag = null; moved = true; }
  else { drag = {x:event.clientX,y:event.clientY,cx:camera.x,cy:camera.y}; moved = false; }
});
canvas.addEventListener('pointermove', event => {
  if (pointers.has(event.pointerId)) pointers.set(event.pointerId, {x:event.offsetX,y:event.offsetY});
  if (pointers.size === 2) { const [a,b] = [...pointers.values()]; const distance = Math.hypot(a.x-b.x,a.y-b.y); if (pinch > 0) zoom(distance / pinch, (a.x+b.x)/2, (a.y+b.y)/2); pinch = distance; return; }
  if (drag) { const dx=event.clientX-drag.x,dy=event.clientY-drag.y; if (Math.hypot(dx,dy)>3) moved=true; camera.x=drag.cx+dx;camera.y=drag.cy+dy;userMoved=true;scheduleDraw();return; }
  const node = nodeAt(event.offsetX,event.offsetY); hovered = node?.id || null; const tip=$('hover-label');tip.hidden=!node;
  if(node){tip.textContent=node.title;tip.style.left=`${Math.max(5,Math.min(width-245,event.offsetX+15))}px`;tip.style.top=`${Math.max(5,Math.min(height-45,event.offsetY+15))}px`;canvas.style.cursor='pointer';}else canvas.style.cursor='grab';scheduleDraw();
});
canvas.addEventListener('pointerup', event => { const wasPinch = pinch !== null; pointers.delete(event.pointerId); if (!moved && !wasPinch) { const node=nodeAt(event.offsetX,event.offsetY);if(node)selectNode(node.id); } drag=null;pinch=null; });
canvas.addEventListener('pointercancel', event => {pointers.delete(event.pointerId);drag=null;pinch=null;});
canvas.addEventListener('pointerleave', () => {hovered=null;$('hover-label').hidden=true;scheduleDraw();});
canvas.addEventListener('wheel', event => {event.preventDefault();zoom(Math.exp(-event.deltaY*.0015),event.offsetX,event.offsetY);},{passive:false});
canvas.addEventListener('keydown',event=>{const shifts={ArrowLeft:[35,0],ArrowRight:[-35,0],ArrowUp:[0,35],ArrowDown:[0,-35]};if(shifts[event.key]){event.preventDefault();camera.x+=shifts[event.key][0];camera.y+=shifts[event.key][1];userMoved=true;scheduleDraw();}else if(event.key==='+'||event.key==='='){event.preventDefault();zoom(1.25);}else if(event.key==='-'){event.preventDefault();zoom(.8);}else if(event.key==='0'){event.preventDefault();fitTree();}});
function scheduleDraw() { if (!animation) animation=requestAnimationFrame(draw); }
function draw() {
  animation=null; const dpr=Math.min(devicePixelRatio||1,2);ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
  $('zoom-label').value=`${Math.round(camera.scale*100)}%`;if(!graph.nodes.size)return;
  let settling=false;
  for(const n of graph.nodes.values()){const dx=n.tx-n.x,dy=n.ty-n.y;if(Math.abs(dx)+Math.abs(dy)>.3){settling=true;n.x+=dx*(reducedMotion?1:.16);n.y+=dy*(reducedMotion?1:.16);}else{n.x=n.tx;n.y=n.ty;}}
  const forestPairs=new Set(graph.forest.map(e=>[e.source,e.target].sort().join('|')));
  const selectedNeighbors=new Set(selected?[selected,...graph.connections(selected).map(e=>e.source===selected?e.target:e.source)]:[]);
  function line(a,b,color,dash=[],weight=1){ctx.beginPath();ctx.setLineDash(dash);ctx.strokeStyle=color;ctx.lineWidth=weight;ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.setLineDash([]);}
  const center={x:width/2+camera.x,y:height/2+camera.y};
  for(const root of graph.roots)line(center,screen(root),'#61748a44',[2,6]);
  const showCross=$('cross-links').checked;
  if(showCross||selected){for(const e of graph.edges.values()){if(forestPairs.has([e.source,e.target].sort().join('|')))continue;if(!showCross&&e.source!==selected&&e.target!==selected)continue;line(screen(graph.nodes.get(e.source)),screen(graph.nodes.get(e.target)),e.source===selected||e.target===selected?'#8ba6d18c':'#50648338',[4,5]);}}
  for(const e of graph.forest){const a=graph.nodes.get(e.source),b=graph.nodes.get(e.target),active=e.source===selected||e.target===selected;line(screen(a),screen(b),active?`${TOPICS[a.topic]}dd`:`${TOPICS[a.topic]}65`,[],active?1.8:1.1);}
  ctx.beginPath();ctx.arc(center.x,center.y,Math.max(13,23*camera.scale),0,Math.PI*2);ctx.fillStyle='#233020';ctx.fill();ctx.strokeStyle='#778b5e';ctx.lineWidth=1;ctx.stroke();ctx.font=`${Math.max(13,22*camera.scale)}px Georgia`;ctx.fillStyle='#c6eaa0';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('W',center.x,center.y);
  for(const n of graph.nodes.values()){
    const p=screen(n),r=Math.max(2.4,radius(n)*camera.scale),active=n.id===selected||n.id===hovered;
    if(p.x < -200 || p.x > width+200 || p.y < -60 || p.y > height+60)continue;
    ctx.globalAlpha = selected && !selectedNeighbors.has(n.id) && !active ? .72 : 1;
    if(active){ctx.beginPath();ctx.arc(p.x,p.y,r+6,0,Math.PI*2);ctx.strokeStyle=TOPICS[n.topic]+'90';ctx.lineWidth=1.5;ctx.stroke();}
    ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.fillStyle=TOPICS[n.topic];ctx.fill();ctx.strokeStyle='#141824';ctx.lineWidth=1.5;ctx.stroke();
    const label=active||graph.nodes.size<=30||camera.scale>.7||(graph.nodes.size<=100&&n.rank<=10);
    if(label){ctx.font=`${active?'600':'400'} 12px system-ui`;const alignLeft=p.x<width-200;ctx.textAlign=alignLeft?'left':'right';ctx.textBaseline='middle';const text=n.title.length>35?n.title.slice(0,33)+'…':n.title;const labelX=p.x+(alignLeft?1:-1)*(r+7);ctx.strokeStyle='#10131eee';ctx.lineWidth=4;ctx.strokeText(text,labelX,p.y);ctx.fillStyle=active?'#ffffff':'#c8d3e4';ctx.fillText(text,labelX,p.y);}ctx.globalAlpha=1;
  }
  if(settling)scheduleDraw();
}
new ResizeObserver(()=>{const rect=$('canvas-wrap').getBoundingClientRect();width=rect.width;height=rect.height;const dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);if(!userMoved)fitTree(false);scheduleDraw();}).observe($('canvas-wrap'));
updateControls();stats();scheduleDraw();
