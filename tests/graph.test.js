import test from 'node:test';
import assert from 'node:assert/strict';
import {ArticleGraph} from '../graph.js';
const article=(pageid,title,links=[],extra={})=>({pageid,title,links,rank:pageid,views:1000,categories:[],aliases:[],...extra});
test('a new bridge joins disconnected groups without inventing links or cycles',()=>{
  const g=new ArticleGraph();g.add(article(1,'Alpha'));g.add(article(2,'Beta'));
  assert.equal(g.roots.length,2);assert.equal(g.edges.size,0);
  g.add(article(3,'Bridge',['Alpha','Beta']));
  assert.equal(g.roots.length,1);assert.equal(g.forest.length,2);assert.equal(g.edges.size,2);
  assert.equal(g.roots[0].title,'Alpha');
  assert.equal(g.forest.length,g.nodes.size-g.roots.length);
});
test('reciprocal links and triangular cycles stay as directed graph edges',()=>{
  const g=new ArticleGraph();g.add(article(1,'Alpha',['Beta','Gamma']));g.add(article(2,'Beta',['Alpha','Gamma']));g.add(article(3,'Gamma',['Alpha']));
  assert.equal(g.edges.size,5);assert.equal(g.forest.length,2);assert.equal(g.roots.length,1);
  const seen=new Set();const visit=n=>{assert.ok(!seen.has(n.id));seen.add(n.id);n.children.forEach(visit);};g.roots.forEach(visit);assert.equal(seen.size,3);
});
test('redirect aliases connect earlier links and repeated page IDs do not duplicate nodes',()=>{
  const g=new ArticleGraph();g.add(article(1,'Alpha',['Old_name']));g.add(article(2,'New name',[],{aliases:['Old name']}));
  assert.equal(g.edges.size,1);assert.equal(g.roots.length,1);
  assert.equal(g.add(article(2,'New name',[],{views:500,rank:5,aliases:['Another name']})),null);
  assert.equal(g.nodes.size,2);assert.equal(g.nodes.get('2').views,1500);assert.equal(g.nodes.get('2').rank,2);
});
test('a large forest has finite positions and one parent per non-root node',()=>{
  const g=new ArticleGraph();for(let i=1;i<=250;i++)g.add(article(i,`Article ${i}`,i>1?[`Article ${Math.floor(i/2)}`]:[]));
  assert.equal(g.roots.length,1);assert.equal(g.forest.length,249);
  for(const n of g.nodes.values()){assert.ok(Number.isFinite(n.tx)&&Number.isFinite(n.ty));if(n.id!=='1')assert.ok(n.parent);}
});
