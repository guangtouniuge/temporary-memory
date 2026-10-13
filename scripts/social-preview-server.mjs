import {createServer} from 'vite'
import {pathToFileURL} from 'node:url'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
export async function startSocialPreview() {
  const cacheDir=await fs.mkdtemp(path.join(os.tmpdir(),'geo-social-vite-'))
  const html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>自媒体发布本地测试</title><div id="root"></div><script type="module" src="/scripts/social-preview.tsx"></script></html>'
  const server=await createServer({configFile:false,cacheDir,server:{host:'127.0.0.1',port:0},plugins:[{
    name:'isolated-social-fixtures',configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
      const url=new URL(req.url,'http://localhost');
      const json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value))}
      if(url.pathname==='/api/auth/me')return json({user:{id:'local-user',workspaceId:'local-workspace',role:'project_admin'}})
      if(url.pathname==='/api/social/accounts')return json({accounts:[]})
      if(url.pathname==='/api/state')return json({value:url.searchParams.get('key')==='geo.activeBrand'?'本地发布测试':Array.from({length:22},(_,i)=>({project:'本地发布测试',name:`本地测试批次${i+1}`,jobId:`local-job-${i+1}`,limit:2,created:2}))})
      if(url.pathname==='/api/jobs/status')return json({job:{articles:[0,1].map(i=>({id:url.searchParams.get('id')+'-'+i,project:'本地发布测试',status:'已生成',title:'2026年服务公司推荐 '+url.searchParams.get('id')+'-'+i,body:'这是隔离测试正文，不会发布到外部平台。\\n\\n![测试文章图](/api/gallery/file?file=article-source.png)'}))}})
      if(url.pathname==='/api/gallery/file'){res.setHeader('Content-Type','image/png');return res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAASwAAADICAYAAABS39xVAAAAAXNSR0IArs4c6QAAAwlJREFUeF7t1AEJAAAIAzH9p3FLDQgKOlOLy7K7AQAAAAA4wQNAAAAAAAAQGgAAAAAAAEBrAAAAAAAAQGsAAAAAAABAawAAAAAAAEBrAAAAAAAAQGsAAAAAAABAawAAAAAAAEBrAAAAAAAAQGsAAAAAAABAawAAAAAAAEBrAAAAAAAAQGsAAAAAAABAawAAAAAAAEBrAAAAAAAAQGsAAAAAAABAawAAAAAAAEBrAAAAAAAAQGsAAAAAAABAawAAAAAAAEBrAAAAAAAAQGsAAAAAAABAawAAAAAAAEBrAAAAAAAAQGsAAAAAAABAawAAAAAAAEBrAAAAAAAAQGsAAAAAAABAawAAAAAAAEBrAAAAAAAAQGsAAAAAAABAawAAAAAAAEBrAAAAAAAAQGsAAAAAAABAawAAAAAAAEBrAAAAAAAAQGsAAAAAAABAawAAAAAAAEBrAAAAAAAAQGsAAAAAAABAawAAAAAAAEBrAAAAAAAAQGsAAAAAAABAawAAAAAAAEBrAAAAAAAAQGsAAAAAAABAawAAAAAAAEBrAAAAAAAAQGsAAAAAAABAawAAAAAAAEBrAAAAAAAAQGsAAAAAAABAawAAAAAAAEBrAAAAAAAAQGsAAAAAAABAawAAAAAAAEBrAAAAAAAAQGsAAAAAAABAawAAAAAAAEBrAAAAAAAAQGsAAAAAAABAawAAAAAAAEBrAAAAAAAAQGsAAAAAAABAawAAAAAAAEBrAAAAAAAAQGsAAAAAAABAawAAAAAAAEBrAAAAAAAAQGsAAAAAAABAawAAAAAAAEBrAAAAAAAAQGsAAAAAAABAawAAAAAAAEBrAAAAAAAAQGsAAAAAAABAawAAAAAAAEBrAAAAAAAAQGsAAAAAAABAawAAAAAAAEBrAAAAAAAAQGsAAAAAAABAawAAAAAAAEBrAAAAAAAAQGsAAAAAAABAawAAAAAAAEBrAAAAAAAAQGsAAAAAAABAawAAAAAAAEBrAAAAAAAAQGsAAAAAAABAawAAAAAAAEBrAAAAAAAAQGsAAAAAAABAawAAAAAAAEBrAAAAAAAAQGsAAAAAAABAawAAAAAAAEBrAAAAAAAAQGsAAAAAAABAawAAAAAAAEBrAAAAAAAAQGsAAAAAAABAawAAAAAAAEBrAAAAAAAAQGsAAAAAAABAawAAAAAAAEBrAAAAAAAAQGsAAAAAAABAawAAAAAAAEBrAAAAAAAAQGsAAAAAAABAawAAAAAAAEBrAAAAAAAAQGsAAAAAAABAawAAAAAAAEBrAAAAAAAAQGsAAAAAAABAawAAAAAAAEBrAAAAAAAAQGsAAAAAAABAawAAAAAAAEBrAAAAAAAAQGsAAAAAAABAawAAAAAAAEBrAAAAAAAAQGsAAAAAAABAawAAAAAAAEBrAAAAAAAAQGsAAAAAAABAawAAAAAAAEBrAAAAAAAAQGsAAAAAAABgBxoDiAABRuP3rQAAAABJRU5ErkJggg==','base64'))}
      if(url.pathname.startsWith('/platform/')){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end('<h1>隔离平台登录页</h1><label>密码<input type="password"></label><button onclick="document.cookie=\'localSession=yes;path=/\';this.textContent=\'已模拟登录\'">模拟登录</button><main><label>文章标题<input aria-label="文章标题" placeholder="标题"></label><label>正文<textarea aria-label="正文" placeholder="正文内容"></textarea></label><label>封面图<input aria-label="封面图" type="file" accept="image/*"></label><button id="publish" onclick="this.textContent=\'已发布\';document.body.dataset.published=\'yes\'">发布</button></main>')}
      if(url.pathname==='/work'||url.pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(await vite.transformIndexHtml('/work',html))}
      next()
    })},
  }]})
  const close=server.close.bind(server)
  server.close=async()=>{try{await close()}finally{await fs.rm(cacheDir,{recursive:true,force:true})}}
  await server.listen();return {server,origin:'http://127.0.0.1:'+server.httpServer.address().port}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const {origin}=await startSocialPreview();console.log('SOCIAL_PREVIEW',origin)}
