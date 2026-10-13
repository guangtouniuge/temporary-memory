import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { selectedMedia } from './core-news-media.mjs'
test('selected media must come from an identifiable checked platform row',async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true})
  try{
    const page=await browser.newPage()
    await page.setContent('<table><thead><tr><th>媒体名称<input type="checkbox" checked></th><th>会员价</th><th>分类</th></tr></thead><tbody><tr><td><input type="checkbox" checked value="media-1">本地新闻</td><td>￥12.50</td><td>综合</td></tr><tr><td><input type="checkbox" value="media-2">未选媒体</td><td>10</td><td>新闻</td></tr></tbody></table>')
    assert.deepEqual(await selectedMedia(page),[{id:'media-1',name:'本地新闻',category:'综合',priceFen:1250}])
    await page.locator('tbody input:checked').evaluate(el=>el.value='on')
    await assert.rejects(selectedMedia(page),/媒体编号/)
    await page.setContent('<input type="checkbox" checked>同意条款')
    await assert.rejects(selectedMedia(page),/没有读取到已选媒体/)
  }finally{await browser.close()}
})
