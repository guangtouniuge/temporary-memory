import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { createBrowserPool, createNewsBrowserServer } from './core-news-browser.mjs'

test('user can type password through the actual system page into the remote login field', async () => {
  const directory=await mkdtemp(join(tmpdir(),'news-login-'))
  const site=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<form onsubmit="event.preventDefault();window.submitted=true"><input style="position:absolute;left:790px;top:306px;width:340px;height:44px" placeholder="请输入用户名"><input type="password" style="position:absolute;left:790px;top:372px;width:340px;height:44px" placeholder="请输入密码"><input placeholder="请输入验证码" style="position:absolute;left:790px;top:438px;width:230px;height:44px"></form>')})
  await new Promise(r=>site.listen(0,'127.0.0.1',r))
  const siteOrigin=`http://127.0.0.1:${site.address().port}`
  const pool=createBrowserPool({chromium,directory,home:siteOrigin,allowed:url=>url.startsWith(siteOrigin),launchOptions:{channel:'chrome'}})
  const browser=await chromium.launch({channel:'chrome',headless:true})
  const origin='http://127.0.0.1'
  const service=createNewsBrowserServer({pool,origin,fetcher:async()=>new Response(JSON.stringify({user:{id:'login-test',workspaceId:'project',role:'project_admin'}}))})
  await new Promise(r=>service.listen(0,'127.0.0.1',r))
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000}})
    await page.addInitScript(()=>{window.__geoIdentity={userId:'login-test',role:'project_admin',projectId:'project'}})
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url())
      if(url.pathname.startsWith('/api/core-news-browser/')){
        const r=await fetch(`http://127.0.0.1:${service.address().port}${url.pathname}`,{method:'POST',headers:{origin,cookie:'local-only','Content-Type':'application/json'},body:route.request().postData()})
        return route.fulfill({status:r.status,contentType:'application/json',body:await r.text()})
      }
      if(url.pathname.startsWith('/api/'))return route.fulfill({json:{ok:true,value:null}})
      const asset=url.pathname.match(/^\/gongju\/assets\/([\w.-]+\.(js|css))$/)
      if(asset)return route.fulfill({contentType:asset[2]==='js'?'application/javascript':'text/css',body:await readFile('dist/assets/'+asset[1])})
      if(url.pathname.endsWith('/core-news-browser.js'))return route.fulfill({contentType:'application/javascript',body:await readFile('public/core-news-browser.js')})
      return route.fulfill({contentType:'text/html',body:await readFile('dist/index.html')})
    })
    await page.goto(origin+'/gongju/agents#/project/core-news')
    await page.getByRole('button',{name:'打开新闻源平台',exact:true}).click()
    const image=page.locator('.cn-stage img[src]');await image.waitFor()
    await page.getByLabel('请输入密码',{exact:true}).click()
    await page.keyboard.type('Local@Password123!')
    await page.waitForTimeout(2000)
    const p=(await pool.open('login-test:project')).page
    const remote={value:await p.locator('input[type=password]').inputValue(),submitted:await p.evaluate(()=>Boolean(window.submitted))}
    assert.equal(remote.value,'Local@Password123!')
    assert.equal(remote.submitted,false)
    assert.equal(await page.getByLabel('请输入密码',{exact:true}).getAttribute('type'),'password')
    await page.getByLabel('请输入密码',{exact:true}).fill('Changed@456')
    await page.waitForTimeout(400)
    assert.equal(await p.locator('input[type=password]').inputValue(),'Changed@456')
    const fields=await (await import('./core-news-fields.mjs')).visibleFields(p)
    assert.equal(fields.find(f=>f.type==='password').value,undefined)
    await assert.rejects((await import('./core-news-fields.mjs')).updateField(p,{id:'not-issued',text:'forbidden'}),/已变化/)
  }finally{await browser.close();await pool.shutdown();await new Promise(r=>service.close(r));await new Promise(r=>site.close(r));await rm(directory,{recursive:true,force:true})}
})
