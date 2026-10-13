import {createRoot,type Root} from 'react-dom/client'
import {SocialPublisher} from '../src/SocialPublisher'
import {readSocialWeb} from '../src/social-web-reader'

const MOUNT_VERSION='social-publisher-execution-v2'
declare global {interface Window {__geoSocialMounted?:boolean|string}}
function ClientChannel({brand}:{brand:string}) {return <SocialPublisher brand={brand} executionOnly />}
let root:Root|null=null,host:HTMLElement|null=null,original:HTMLElement|null=null,originalNav:HTMLElement|null=null,pending=false
function clear(){root?.unmount();root=null;host?.remove();host=null;if(original)original.style.display='';original=null;if(originalNav)originalNav.style.display='';originalNav=null;document.body.classList.remove('geo-social-client-shell','geo-social-booting');void window.geoSocialClient?.request('closeBrowser')}
function ensureShellStyle() {
  let style=document.getElementById('geo-social-client-shell-style') as HTMLStyleElement|null
  if(!style){style=document.createElement('style');style.id='geo-social-client-shell-style';document.head.appendChild(style)}
  style.textContent='body.geo-social-client-shell .account-bar,body.geo-social-client-shell .console-topbar,body.geo-social-client-shell .sidebar,body.geo-social-client-shell aside,body.geo-social-client-shell [data-geo-social-client-error],body.geo-social-client-shell [class*="sidebar"],body.geo-social-client-shell [class*="Side"],body.geo-social-client-shell [class*="breadcrumb"],body.geo-social-client-shell [class*="Breadcrumb"]{display:none!important}body.geo-social-client-shell .app,body.geo-social-client-shell #root>div,body.geo-social-client-shell main.workspace{display:block!important;width:100%!important;max-width:none!important;min-width:0!important;margin:0!important;padding:0!important}body.geo-social-client-shell [data-geo-social-client]{display:block!important;max-width:1180px;margin:0 auto;padding:20px 24px 36px;box-sizing:border-box}'
}
function hideShellElements() {
  document.querySelectorAll<HTMLElement>('.account-bar,.console-topbar,.sidebar,aside,[data-geo-social-client-error],[class*="sidebar"],[class*="Side"],[class*="breadcrumb"],[class*="Breadcrumb"]').forEach(el=>el.style.setProperty('display','none','important'))
}
async function sync() {
  for(const button of document.querySelectorAll('.sidebar .nav-child'))for(const node of button.childNodes)if(node.nodeType===Node.TEXT_NODE&&['自媒体渠道-1','品牌账号投喂','品牌媒体投喂'].includes(node.textContent?.trim()||''))node.textContent='自有媒体投喂'
  if(!location.hash.includes('/distribution')){if(root)clear();return}
  if(root&&host?.isConnected&&original?.isConnected)return
  if(pending)return
  const existingHost=document.querySelector<HTMLElement>('[data-geo-social-client]')
  const target=document.querySelector<HTMLElement>('.media-channel-social')||[...document.querySelectorAll<HTMLElement>('.social-publisher')].find(node=>!node.closest('[data-geo-social-client]'))
  if(!target)return
  pending=true
  try {
    const response=window.geoSocialClient?await window.geoSocialClient.request('snapshot'):{ok:true,value:await readSocialWeb('snapshot')}
    if(!response.ok)throw Error(response.error||'本地发布工作台读取失败')
    if(!response.ok||!target.isConnected||!location.hash.includes('/distribution'))return
    document.querySelectorAll('[data-geo-social-client-error]').forEach(node=>node.remove())
    clear();document.body.classList.add('geo-social-client-shell');document.body.classList.remove('geo-social-booting');ensureShellStyle();hideShellElements();original=target;original.style.display='none';originalNav=target.previousElementSibling?.classList.contains('social-channel-tabs')?target.previousElementSibling as HTMLElement:null;if(originalNav)originalNav.style.display='none';host=existingHost||document.createElement('section');host.dataset.geoSocialClient='true';host.replaceChildren();if(!existingHost)(originalNav||target).before(host);root=createRoot(host);root.render(<ClientChannel brand={response.value.brand}/>)
  } catch (error) {
    if(!document.querySelector('[data-geo-social-client-error]')) {
      const box=document.createElement('div')
      box.dataset.geoSocialClientError='true'
      box.style.cssText='margin:14px 0;padding:12px 15px;border-left:3px solid #d74456;background:#fff1f2;color:#b42335;font-size:13px'
      box.textContent='本地发布工作台加载失败：'+(error instanceof Error?error.message:'请重新登录后刷新')
      target.before(box)
    }
  }
  finally {pending=false}
}
if(window.__geoSocialMounted!==MOUNT_VERSION){window.__geoSocialMounted=MOUNT_VERSION;const observer=new MutationObserver(()=>void sync());observer.observe(document.body,{childList:true,subtree:true});window.addEventListener('hashchange',()=>void sync());void sync()}
