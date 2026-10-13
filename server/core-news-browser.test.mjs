import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import http from 'node:http'
import { chromium } from 'playwright'
import { createBrowserPool, createNewsBrowserServer, newsURL } from './core-news-browser.mjs'

test('multi-batch selection counts complete articles, deduplicates and rejects other brands', async () => {
  const article = id => ({id, title:id, project:'A', status:'已生成', body:'完整正文'})
  const fetcher = async address => {
    const url = new URL(address)
    let value
    if(url.pathname==='/api/auth/me') value={user:{id:'test',workspaceId:'p',role:'project_admin'}}
    else if(url.searchParams.get('key')==='geo.activeBrand') value={value:'A'}
    else if(url.searchParams.get('key')==='geo.taskRows') value={value:[{project:'A',name:'第一批',jobId:'j1',limit:3},{project:'A',name:'第二批',jobId:'j2',limit:2},{project:'B',name:'其他品牌',jobId:'j3'}]}
    else value={job:{articles:url.searchParams.get('id')==='j1'?[article('a'),article('shared'),{...article('secret'),project:'B'}]:[article('shared'),article('b')]}}
    return new Response(JSON.stringify(value))
  }
  const server=createNewsBrowserServer({pool:{},fetcher,origin:'http://127.0.0.1'})
  await new Promise(r=>server.listen(0,'127.0.0.1',r))
  const call=ids=>fetch(`http://127.0.0.1:${server.address().port}/api/core-news-browser/selection`,{method:'POST',headers:{origin:'http://127.0.0.1',cookie:'local-test','Content-Type':'application/json'},body:JSON.stringify({batchIds:ids})})
  try {
    const response=await call(['j1','j2']); assert.equal(response.status,200)
    const result=await response.json()
    assert.equal(result.articleCount,3)
    assert.deepEqual(result.articles.map(row=>row.id),['a','shared','b'])
    assert.deepEqual(result.batches.map(row=>row.available),[2,2])
    assert.equal((await call(['j1','j3'])).status,404)
    assert.equal((await call(['j1','j1'])).status,400)
    assert.equal((await call([])).status,400)
  } finally { await new Promise(r=>server.close(r)) }
})

test('news browser requires same-origin authentication and isolates accounts', async () => {
  const keys = []
  const pool = { async open(key) { keys.push(key) }, async close() {}, async use() { throw Error('not needed') } }
  const fetcher = async (_, { headers }) => new Response(JSON.stringify({ user: { id: headers.cookie, role: 'project_admin', workspaceId: 'brand-project' } }), { status: 200 })
  const server = createNewsBrowserServer({ pool, fetcher, origin: 'http://127.0.0.1' })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${server.address().port}/api/core-news-browser/open`
  const send = headers => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: '{}' })
  try {
    assert.equal((await send({ origin: 'https://evil.invalid', cookie: 'A' })).status, 403)
    assert.equal((await send({ origin: 'http://127.0.0.1' })).status, 401)
    assert.equal((await send({ origin: 'http://127.0.0.1', cookie: 'A' })).status, 200)
    assert.equal((await send({ origin: 'http://127.0.0.1', cookie: 'B' })).status, 200)
    assert.deepEqual(keys, ['A:brand-project', 'B:brand-project'])
    assert.equal(newsURL('http://127.0.0.1/'), false)
    assert.equal(newsURL('http://xinwen.7chacha.com@127.0.0.1/'), false)
    assert.equal(newsURL('file:///etc/passwd'), false)
    assert.equal(newsURL('http://xinwen.7chacha.com/user/order/index.html'), true)
  } finally { await new Promise(r => server.close(r)) }
})

test('real controlled browser renders, accepts input, keeps sessions separate and enforces capacity', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'geo-remote-news-'))
  const site = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<h1>本地新闻平台</h1><input id="title"><div contenteditable="true"></div>') })
  await new Promise(r => site.listen(0, '127.0.0.1', r))
  const origin = `http://127.0.0.1:${site.address().port}`
  const pool = createBrowserPool({ chromium, directory, home: origin, allowed: url => url.startsWith(origin + '/'), max: 1, launchOptions: { channel: 'chrome' } })
  const service = createNewsBrowserServer({pool, origin, fetcher:async()=>new Response(JSON.stringify({user:{id:'A',workspaceId:'project',role:'project_admin'}}))})
  await new Promise(r=>service.listen(0,'127.0.0.1',r))
  const call=async(action,body={})=>{
    const response=await fetch(`http://127.0.0.1:${service.address().port}/api/core-news-browser/${action}`,{method:'POST',headers:{origin,cookie:'isolated-test','Content-Type':'application/json'},body:JSON.stringify(body)})
    assert.equal(response.status,200);return response.json()
  }
  try {
    await call('open')
    await pool.use('A:project',page=>page.locator('input').focus())
    await call('input',{type:'text',text:'场景内输入验证'})
    await pool.use('A:project',async page=>assert.equal(await page.locator('input').inputValue(),'场景内输入验证'))
    assert.ok((await call('frame')).image.length>100)
    await call('close')
    await pool.open('A')
    await pool.use('A', async page => { await page.locator('input').fill('独立会话'); assert.ok((await page.screenshot()).length > 100); await page.evaluate(() => localStorage.setItem('onlyA', 'yes')) })
    await assert.rejects(pool.open('B'), /繁忙/)
    await pool.close('A'); await pool.open('B')
    await pool.use('B', async page => assert.equal(await page.evaluate(() => localStorage.getItem('onlyA')), null))
    await pool.close('B'); await pool.open('A')
    await pool.use('A', async page => assert.equal(await page.evaluate(() => localStorage.getItem('onlyA')), 'yes'))
  } finally { await pool.shutdown(); await new Promise(r => site.close(r)); await new Promise(r=>service.close(r)); await rm(directory, { recursive: true, force: true }) }
})
