import test from 'node:test';
import assert from 'node:assert/strict';
import {WikipediaClient} from '../wiki.js';
const response=(data,status=200)=>({ok:status===200,status,headers:new Headers(),json:async()=>data});
const clientWith=fetcher=>{const client=new WikipediaClient({fetcher});client.delay=async()=>{};return client;};
test('the parser follows combined link, category and redirect continuations',async()=>{
  const calls=[];const client=clientWith(async url=>{calls.push(new URL(url));return calls.length===1?response({query:{pages:[{pageid:10,ns:0,title:'Canonical',extract:'Summary',links:[{title:'A'}],categories:[{title:'Category:Science'}],redirects:[{title:'Old name'}]}]},continue:{plcontinue:'10|0|B',rdcontinue:'20',continue:'||'}}):response({query:{pages:[{pageid:10,links:[{title:'B'},{title:'A'}],categories:[{title:'Category:Physics'}],redirects:[{title:'Older name'}]}]}});});
  const result=await client.article({title:'Original name',rank:3,views:2500});
  assert.deepEqual(result.links,['A','B']);assert.deepEqual(result.categories,['Science','Physics']);assert.deepEqual(result.aliases,['Original name','Old name','Older name']);
  assert.equal(calls[1].searchParams.get('plcontinue'),'10|0|B');assert.equal(calls[1].searchParams.get('pageids'),'10');assert.equal(calls[1].searchParams.get('rdcontinue'),'20');
});
test('disambiguation pages and missing articles are skipped',async()=>{
  for(const page of [{pageid:1,ns:0,title:'Ambiguous',pageprops:{disambiguation:''}},{ns:0,title:'Missing',missing:true}]){const c=clientWith(async()=>response({query:{pages:[page]}}));assert.equal(await c.article({title:page.title}),null);}
});
test('rankings use UTC, fall back on unavailable dates, and remove system pages',async()=>{
  const urls=[];const c=clientWith(async url=>{urls.push(url);return urls.length===1?response({},404):response({items:[{articles:[{article:'Main_Page',rank:1,views:999},{article:'Special:Search',rank:2,views:500},{article:'Real_article',rank:3,views:300},{article:'Star_Trek:_Voyager',rank:4,views:200}]}]});});
  const result=await c.ranking(new Date('2026-09-30T00:30:00+02:00'));
  assert.ok(urls[0].endsWith('/2026/09/28'));assert.equal(result.date,'2026-09-27');assert.deepEqual(result.articles.map(a=>a.title),['Real article','Star Trek: Voyager']);
});
test('aborting a run prevents article requests',async()=>{
  const controller=new AbortController();controller.abort();let calls=0;
  const c=new WikipediaClient({signal:controller.signal,fetcher:async()=>{calls++;return response({});}});
  await assert.rejects(()=>c.article({title:'Earth'}));assert.equal(calls,0);
});
test('transient rate limits are retried, permanent failures are surfaced',async()=>{
  let calls=0;const c=clientWith(async()=>++calls===1?response({},429):response({ready:true}));assert.deepEqual(await c.request('https://example.test'),{ready:true});assert.equal(calls,2);
  const fail=clientWith(async()=>response({},403));await assert.rejects(()=>fail.request('https://example.test'),/403/);
});
