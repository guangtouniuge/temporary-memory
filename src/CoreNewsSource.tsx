import { ExternalLink, Globe, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import './core-news-source.css'

export const CORE_NEWS_URL = 'http://xinwen.7chacha.com/'

export function CoreNewsSource() {
  const [revision, setRevision] = useState(0)
  const blockedByMixedContent = window.location.protocol === 'https:'
  return <section className="operation-page core-news-source">
    <div className="operation-toolbar">
      <strong>核心新闻源</strong>
      <a className="primary-button" href={CORE_NEWS_URL} target="_blank" rel="noopener noreferrer"><ExternalLink size={16} />新窗口打开</a>
    </div>
    <div className="news-browser-toolbar">
      <Globe size={18} aria-hidden="true" />
      <span className="news-browser-address">{CORE_NEWS_URL}</span>
      {!blockedByMixedContent && <button title="重新加载网站" aria-label="重新加载网站" onClick={() => setRevision(value => value + 1)}><RefreshCw size={16} /></button>}
    </div>
    {blockedByMixedContent ? <div className="news-browser-unavailable" role="status">
      <Globe size={32} aria-hidden="true" />
      <h2>此网站需在新窗口打开</h2>
      <p>当前后台使用HTTPS，该新闻源使用HTTP，浏览器禁止在此内嵌。</p>
      <a className="ghost-button" href={CORE_NEWS_URL} target="_blank" rel="noopener noreferrer"><ExternalLink size={16} />打开核心新闻源</a>
    </div> : <>
      <p className="news-browser-notice">若网站拒绝内嵌或登录页未显示，请在新窗口打开。</p>
      <iframe key={revision} className="news-browser-frame" title="核心新闻源网站" src={CORE_NEWS_URL} referrerPolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads" />
    </>}
    <p className="news-browser-notice">该网站独立登录，HTTP连接未加密，请确认安全后再登录。发稿与审核状态以该网站为准，暂未自动同步到本系统。</p>
  </section>
}
