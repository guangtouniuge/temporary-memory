import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

test('named channels dispatch social content and fold the old B2B entry into news', async () => {
  const vite = await createServer({ configFile: false, base: '/', plugins: [react()], server: { host: '127.0.0.1', port: 5177 } })
  await vite.listen()
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    const store = { 'geo.activeBrand': '品牌A', 'geo.projectRows': [{ name: '品牌A' }], 'geo.taskRows': [], 'geo.articleRows': [{ id: 'a', title: '已生成文章', project: '品牌A', body: '正文与配图', words: '100', status: '已生成' }, { id: 'b', title: '其他品牌文章', project: '品牌B', body: '不可选', status: '已生成' }] }
    let drafts = [], lastMediaQuery, quoteBody, dispatches=0, orders=[]
    for (let i = 2; i <= 5; i++) store['geo.articleRows'].push({ id: `a${i}`, title: `成品文章${i}`, project: '品牌A', body: '可发布正文', words: '200', status: '已生成' })
    await page.addInitScript(() => { window.__geoIdentity = { userId: 'test', role: 'project_admin', projectId: 'project-a' } })
    await page.route('**/api/**', async route => {
      const req = route.request(); const url = new URL(req.url())
      if (url.pathname === '/api/state') return route.fulfill({ json: { ok: true, value: store[url.searchParams.get('key')] ?? null } })
      if (url.pathname === '/api/news/content') return route.fulfill({json:{articles:store['geo.articleRows'],brands:['品牌A']}})
      if (url.pathname === '/api/news/orders') return route.fulfill({json:{orders}})
      if (url.pathname === '/api/social/accounts') return route.fulfill({json:{ok:true,accounts:[]}})
      if (url.pathname === '/api/social/tasks') return route.fulfill({json:{ok:true,tasks:[]}})
      if (url.pathname === '/api/news/quote') {
        quoteBody=req.postDataJSON()
        orders=[{id:'order',channel:quoteBody.channel,brand:'品牌A',articleId:'a',title:quoteBody.edits.a?.title||'成品',state:'quoted',priceCents:8000}]
        return route.fulfill({json:{orders,funding:{availableCents:10000,availablePublications:10,requiredCents:8000,requiredPublications:5,reason:''}}})
      }
      if (url.pathname === '/api/news/dispatch') {dispatches++;orders=orders.map(o=>({...o,state:'submitted',orderId:'123'}));return route.fulfill({json:{orders}})}
      if (url.pathname === '/api/media/resources') {
        lastMediaQuery=url.searchParams
        return route.fulfill({ json: { resources: [{ resource_id: 1, title: '样本媒体', price: '10',details:{type:'自媒体账号',platform:'今日头条',category:'健康',region:'自媒体账号',industry:'健康',verification:'已认证',mediaIdentity:'非官方媒体',subject:'未提供'} }, { resource_id: 2, title: '新闻媒体B', price: '25', remarks: '图文稿件', details:{type:'网络媒体',platform:'新闻资讯',category:'未提供',region:'北京'} }],total:2,totalPages:1,catalogTotal:2,page:1,complete:true,updatedAt:new Date().toISOString(),fields:[{id:'自媒体账号',type:'field_0',title:'自媒体账号',count:1},{id:'网络媒体',type:'field_0',title:'网络媒体',count:1},{id:'1006',type:'field_1',title:'今日头条',count:2},{id:'2010',type:'field_2',title:'健康',count:2},{id:'6001',type:'field_6',title:'已认证',count:2},{id:'7002',type:'field_7',title:'非官方媒体',count:2}] } })
      }
      if (url.pathname === '/api/media/drafts') {
        if (req.method() === 'POST') { const body = req.postDataJSON(); assert.equal(body.articles[0].id, 'a'); drafts = [{ ...body, id: 'draft', status: '待发布', createdAt: new Date().toISOString() }] }
        return route.fulfill({ json: { ok: true, drafts: drafts.filter(d => d.channel === url.searchParams.get('channel')) } })
      }
      assert.notEqual(url.pathname, '/api/media/publish', 'test workflow never publishes')
      return route.fulfill({ json: { ok: true } })
    })
    await page.goto(vite.resolvedUrls.local[0] + '#/project/distribution')
    await page.getByRole('heading', { name: '自有媒体投喂', exact: true }).waitFor()
    assert.equal(await page.getByRole('tab', { name: '媒体资源投稿', exact: true }).count(), 0)
    assert.equal(await page.getByRole('button',{name:'B2B网站',exact:true}).count(),0)
    await page.goto(vite.resolvedUrls.local[0]+'#/project/media-b2b')
    await page.getByRole('heading',{name:'补充媒体投喂',exact:true}).waitFor()
    await page.getByRole('button',{name:'选择媒体',exact:true}).waitFor()
    assert.equal(await page.getByRole('button',{name:'选择媒体',exact:true}).isDisabled(),false)
    await page.getByRole('button',{name:'选择媒体',exact:true}).click()
    await page.getByLabel('样本媒体',{exact:true}).waitFor()
    assert.equal(lastMediaQuery.get('channel'),'news')
    assert.equal(await page.getByLabel('样本媒体',{exact:true}).isChecked(),false)
    await page.getByLabel('样本媒体',{exact:true}).check()
    await page.getByRole('button',{name:'确认发布稿',exact:true}).click()
    await page.getByRole('button',{name:'确认扣费并分发',exact:true}).click()
    await page.locator('.media-state').filter({hasText:'执行中'}).first().waitFor()
    assert.equal(quoteBody.channel,'news');assert.equal(dispatches,1)
    await page.goto(vite.resolvedUrls.local[0]+'#/project/media-news2')
    await page.getByRole('heading',{name:'核心媒体投喂',exact:true}).waitFor()
    await page.getByRole('button',{name:'选择媒体',exact:true}).waitFor()
    await page.getByLabel('本次发布篇数').fill('3')
    await Promise.all([
      page.waitForResponse(r=>r.url().includes('/api/media/resources?')&&r.url().includes('channel=news2')),
      page.getByRole('button',{name:'选择媒体',exact:true}).click(),
    ])
    assert.equal(lastMediaQuery.get('channel'),'news2')
    await page.locator('.media-market-filter-row').filter({hasText:'媒体类型'}).getByRole('button',{name:'自媒体账号',exact:true}).click()
    await page.waitForResponse(r=>r.url().includes('/api/media/resources?')&&r.url().includes('mediaType=%E8%87%AA%E5%AA%92%E4%BD%93%E8%B4%A6%E5%8F%B7'))
    assert.equal(lastMediaQuery.get('mediaType'),'自媒体账号')
    await page.locator('.media-market-filter-row').filter({hasText:'内容分类'}).getByRole('button',{name:'健康',exact:true}).click()
    await page.waitForResponse(r=>r.url().includes('/api/media/resources?')&&r.url().includes('industry=2010'))
    assert.equal(lastMediaQuery.get('industry'),'2010')
    await page.getByLabel('样本媒体',{exact:true}).check()
    await page.getByLabel('样本媒体发布篇数',{exact:true}).fill('3')
    await page.getByRole('button',{name:'确认发布稿',exact:true}).click()
    await page.getByRole('button',{name:'确认扣费并分发',exact:true}).click()
    await page.locator('.media-state').filter({hasText:'执行中'}).first().waitFor()
    assert.equal(quoteBody.channel,'news2');assert.equal(dispatches,2)
    assert.equal(quoteBody.allocations[0].articleIds.length,3)
    assert.equal(await page.getByRole('button', { name: '视频', exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: '核心新闻源', exact: true }).count(), 0)
    assert.deepEqual(errors, [])
  } finally { await browser.close(); await vite.close() }
})
