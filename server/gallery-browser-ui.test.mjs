import test from 'node:test'
import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {createServer} from 'vite'
import react from '@vitejs/plugin-react'

test('gallery has two counted folders, scoped paginated lists, preview and simple upload on desktop/mobile',async()=>{
  const vite=await createServer({configFile:false,base:'/',plugins:[react()],server:{host:'127.0.0.1',port:0}})
  await vite.listen()
  const browser=await chromium.launch({channel:'chrome',headless:true})
  try {
    const page=await browser.newPage({viewport:{width:1440,height:900}})
    const pixel='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
    const store={'geo.activeBrand':'品牌A','geo.projectRows':[{name:'品牌A'}],'geo.galleryRows':[
      ...Array.from({length:23},(_,i)=>['品牌A','AI场景图','正文配图','','2026-09-15',pixel,`图片${i}`,'ai']),
      ['品牌A','图片','配图','','2026-09-15',pixel,'自有图片','imported'],
      ['品牌B','图片','配图','','2026-09-15',pixel,'不属于本项目','ai']
    ]}
    await page.addInitScript(()=>{window.__geoIdentity={userId:'test',role:'project_admin',projectId:'project-a'}})
    let upload
    await page.route('**/api/**',route=>{
      const url=new URL(route.request().url())
      if(url.pathname==='/api/gallery/upload'){upload=route.request().postDataJSON();return route.fulfill({json:{ok:true,files:[{name:'new.png',path:'/api/gallery/file?file=new.png'}]}})}
      if(url.pathname==='/api/gallery/file'){
        assert.equal(route.request().headers()['x-geo-project-id'],'project-a')
        return route.fulfill({status:404,body:'missing'})
      }
      if(route.request().method()==='POST'){const{key,value}=route.request().postDataJSON();store[key]=value;return route.fulfill({json:{ok:true,value}})}
      return route.fulfill({json:{ok:true,value:store[url.searchParams.get('key')]??null}})
    })
    await page.goto(vite.resolvedUrls.local[0]+'#/project/gallery')
    await page.getByRole('button',{name:'AI图库 23张'}).waitFor()
    assert.equal(await page.locator('.gallery-image-row').count(),0)
    assert.equal(await page.getByText('配图原则').count(),0)
    await page.screenshot({path:'outputs/gallery-folders-desktop.png',fullPage:true})
    await page.getByRole('button',{name:'添加图库',exact:true}).click()
    await page.locator('input[type=file]').setInputFiles({name:'new.png',mimeType:'image/png',buffer:Buffer.from(pixel.split(',')[1],'base64')})
    await page.getByRole('button',{name:'保存图片',exact:true}).click()
    await page.getByText('new.png',{exact:true}).waitFor()
    assert.equal(upload.brand,'品牌A');assert.equal(upload.category,'自有图片')
    await page.getByRole('img',{name:'new.png，图片加载失败'}).waitFor()
    await page.getByRole('button',{name:'返回图库'}).click()
    await page.getByRole('button',{name:'品牌图库 2张'}).waitFor()
    await page.getByRole('button',{name:'AI图库 23张'}).click()
    assert.equal(await page.getByRole('button',{name:'上传图片',exact:true}).count(),0)
    assert.equal(await page.locator('.gallery-image-row').count(),20)
    await page.getByRole('button',{name:'下一页'}).click()
    assert.equal(await page.locator('.gallery-image-row').count(),3)
    await page.getByRole('button',{name:'预览',exact:true}).first().click()
    await page.getByText('图片预览',{exact:true}).waitFor()
    await page.getByRole('button',{name:'关闭',exact:true}).click()
    await page.getByRole('button',{name:'返回图库'}).click()
    await page.getByRole('button',{name:'品牌图库 2张'}).click()
    await page.getByRole('button',{name:'上传图片',exact:true}).click()
    assert.equal(await page.locator('.form-modal select').count(),0)
    assert.equal(await page.locator('.form-modal input[type=file]').count(),1)
    await page.getByRole('button',{name:'取消',exact:true}).click()
    await page.setViewportSize({width:390,height:844})
    const box=await page.locator('.gallery-browser').boundingBox()
    assert.ok(box.x>=0&&box.x+box.width<=391)
    assert.equal(await page.locator('.gallery-browser').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true)
    await page.screenshot({path:'outputs/gallery-list-mobile.png',fullPage:true})
    await page.getByRole('button',{name:'返回图库'}).click()
    await page.screenshot({path:'outputs/gallery-folders-mobile.png',fullPage:true})
  }finally{await browser.close();await vite.close()}
})
