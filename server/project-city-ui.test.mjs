import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

test('brand city accepts a custom city and persists it without an option list', async () => {
  const vite = await createServer({ configFile:false, base:'/', plugins:[react()], server:{host:'127.0.0.1',port:0} })
  await vite.listen()
  const browser = await chromium.launch({channel:'chrome',headless:true})
  try {
    const page = await browser.newPage()
    const store = {}
    await page.addInitScript(() => {window.__geoIdentity={userId:'local-test',role:'project_admin',projectId:'local-project'}})
    await page.route('**/api/**',async route=>{
      const req=route.request(),url=new URL(req.url())
      if(url.pathname==='/api/state') {
        if(req.method()==='POST'){const body=req.postDataJSON();store[body.key]=body.value}
        return route.fulfill({json:{ok:true,value:store[url.searchParams.get('key')]??null}})
      }
      return route.fulfill({json:{ok:true}})
    })
    await page.goto(vite.resolvedUrls.local[0]+'#/project/projects')
    await page.getByRole('button',{name:'添加品牌',exact:true}).click()
    await page.getByLabel('项目名称',{exact:true}).fill('本地隔离品牌')
    await page.getByLabel('推荐名称',{exact:true}).fill('本地品牌')
    await page.getByLabel('行业',{exact:true}).fill('企业服务')
    const city=page.getByRole('textbox',{name:'城市',exact:true})
    await city.fill('石家庄市正定县')
    assert.equal(await page.getByRole('combobox',{name:'城市',exact:true}).count(),0)
    await page.getByRole('button',{name:'确定',exact:true}).click()
    await page.getByText('石家庄市正定县',{exact:true}).waitFor()
    await page.waitForTimeout(1000)
    assert.equal(store['geo.projectRows'][0].city,'石家庄市正定县')
  } finally {await browser.close();await vite.close()}
})
