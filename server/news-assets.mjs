import {randomBytes,createHash} from 'node:crypto'
import {readFileSync,realpathSync} from 'node:fs'
import {relative,isAbsolute,extname} from 'node:path'
import sanitizeHtml from 'sanitize-html'
import {assertGalleryReference,projectDirectory} from './project-scope.mjs'

const types={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp'}
const fail=()=>{throw Object.assign(new Error('投稿配图不存在或不属于当前项目，请检查文章配图'),{status:400})}
export function prepareNewsImages(html){
  const assets=[]
  const origin=new URL(process.env.GEO_PUBLIC_ORIGIN||'https://geoskill.7chacha.com').origin
  const content=sanitizeHtml(html,{
    allowedTags:[...sanitizeHtml.defaults.allowedTags,'img'],
    allowedAttributes:{...sanitizeHtml.defaults.allowedAttributes,img:['src','alt','width','height']},
    transformTags:{img(tag,attrs){
      let src=attrs.src||''
      if(/^https?:\/\//i.test(src)){
        const u=new URL(src)
        if(u.origin!==origin||u.pathname!=='/api/gallery/file')return {tagName:tag,attribs:attrs}
        src=u.pathname+u.search
      }
      try{
        const path=realpathSync(assertGalleryReference(src)),root=realpathSync(projectDirectory('uploads'))
        const rel=relative(root,path),type=types[extname(path).toLowerCase()]
        if(!rel||rel.startsWith('..')||isAbsolute(rel)||!type)fail()
        const bytes=readFileSync(path)
        if(!bytes.length||bytes.length>20*1024*1024)fail()
        const token=randomBytes(32).toString('hex'),hash=createHash('sha256').update(bytes).digest('hex')
        assets.push({token,path,hash,type})
        return {tagName:tag,attribs:{...attrs,src:`${origin}/api/news-image/${token}`}}
      }catch{fail()}
    }},
  })
  return {content,assets}
}
export function newsImageBytes(asset){
  try{const bytes=readFileSync(asset.path);if(createHash('sha256').update(bytes).digest('hex')!==asset.hash)fail();return bytes}catch{fail()}
}
