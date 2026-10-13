import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

test('distillation UI sends quantity, preserves failures and reloads saved terms', async () => {
  const vite=await createServer({configFile:false,plugins:[react()],server:{host:'127.0.0.1',port:0}})
  await vite.listen()
  const browser=await chromium.launch({channel:process.env.GEO_TEST_BROWSER||'chrome',headless:true})
  try {
    const page=await browser.newPage()
    const brand='测试品牌',core='西安GEO公司',old=[brand,core,core+'哪家好','未收录','2026-09-14']
    const store={'geo.projectRows':[{name:brand,brand,coreKeyword:core,industry:'GEO服务'}],'geo.activeBrand':brand,'geo.keywordRows':[[brand,core,'1','已启用','2026-09-14']],'geo.questionRows':[old]}
    let calls=0
    const errors=[]
    page.on('pageerror',e=>errors.push(e.message))
    await page.addInitScript(()=>{window.__geoIdentity={userId:'u',role:'project_admin',projectId:'a'}})
    await page.route('**/api/**',async route=>{
      const req=route.request(),url=new URL(req.url())
      if(url.pathname==='/api/state') {
        if(req.method()==='POST'){const {key,value}=req.postDataJSON();store[key]=value}
        return route.fulfill({json:{ok:true,value:store[url.searchParams.get('key')]??null}})
      }
      if(url.pathname==='/api/keywords/distill') {
        assert.deepEqual(req.postDataJSON(),{brand,coreKeyword:core,count:2})
        calls++
        if(calls===1)return route.fulfill({status:409,json:{ok:false,error:'关键词额度不足'}})
        const terms=[core+'哪家靠谱',core+'怎么选']
        store['geo.questionRows']=[old,...terms.map(t=>[brand,core,t,'未收录','2026-09-14'])]
        store['geo.keywordRows']=[[brand,core,'3','已启用','2026-09-14']]
        return route.fulfill({json:{ok:true,terms,keywordRows:store['geo.keywordRows'],questionRows:store['geo.questionRows']}})
      }
      return route.fulfill({json:{ok:true}})
    })
    await page.goto(vite.resolvedUrls.local[0])
    await page.getByRole('button',{name:'品牌资料库',exact:true}).click()
    await page.getByRole('button',{name:'关键词',exact:true}).click()
    await page.getByRole('button',{name:'拓展',exact:true}).click()
    await page.getByLabel('拓展数量',{exact:true}).fill('2')
    await page.getByRole('button',{name:'一键蒸馏',exact:true}).click()
    await page.getByRole('alert').filter({hasText:'关键词额度不足'}).waitFor()
    assert.deepEqual(store['geo.questionRows'],[old])
    await page.getByRole('button',{name:'一键蒸馏',exact:true}).click()
    await page.getByText(core+'哪家靠谱',{exact:true}).waitFor()
    await page.getByText(core+'哪家好',{exact:true}).waitFor()
    assert.equal(store['geo.questionRows'].length,3)
    assert.deepEqual(errors,[])
  } finally {await browser.close();await vite.close()}
})
