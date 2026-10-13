import {randomUUID} from 'node:crypto'
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})}
const stalePublicationAgeMs=48*60*60*1000
export function createNewsOrders(sql,{transact,update,balance}) {
  sql.exec('CREATE TABLE IF NOT EXISTS news_orders(id TEXT PRIMARY KEY,owner TEXT NOT NULL,request_key TEXT UNIQUE NOT NULL,state TEXT NOT NULL,data TEXT NOT NULL)')
  const row=(owner,id)=>{const r=sql.prepare('SELECT * FROM news_orders WHERE id=? AND owner=?').get(id,owner);if(!r)fail(404,'发布订单不存在');return {...r,data:JSON.parse(r.data)}}
  const save=r=>sql.prepare('UPDATE news_orders SET state=?,data=? WHERE id=?').run(r.state,JSON.stringify(r.data),r.id)
  const entry=(r,resource,delta,phase)=>{
    const amount=update(r.owner,resource,delta)
    sql.prepare('INSERT INTO entries VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),`news:${r.id}:${phase}:${resource}`,r.id,'news',r.owner,r.owner,'',resource,delta,amount.before,amount.after,`新闻发布${phase}`,new Date().toISOString())
  }
  const refundReserved=(r,phase,reason)=>{
    entry(r,'money',r.data.priceCents,phase);entry(r,'publications',1,phase)
    r.state='refunded'
    r.data.rejection=String(reason||phase).slice(0,300)
    r.data.checkedAt=new Date().toISOString()
    save(r)
  }
  const cancelUncharged=(r,reason)=>{
    r.state='cancelled'
    r.data.rejection=String(reason||'超过48小时未发布成功，系统自动按发布失败处理').slice(0,300)
    r.data.checkedAt=new Date().toISOString()
    save(r)
  }
  const refundAccepted=(r,phase,reason)=>{
    entry(r,'money',r.data.priceCents,phase);entry(r,'publications',1,phase)
    for(const [resource,quantity] of [['money',r.data.priceCents],['publications',1]])sql.prepare('UPDATE wallets SET used=max(used-?,0) WHERE owner=? AND resource=?').run(quantity,r.owner,resource)
    r.state='refunded'
    r.data.rejection=String(reason||phase).slice(0,300)
    r.data.refundInfo=String(reason||phase).slice(0,300)
    r.data.checkedAt=new Date().toISOString()
    save(r)
  }
  const safe=r=>({id:r.id,...r.data,state:r.state})
  const funding=(owner,rows)=>{
    const pending=rows.filter(r=>['quoted','scheduled'].includes(r.state)),requiredCents=pending.reduce((n,r)=>n+r.data.priceCents,0),requiredPublications=pending.length
    const availableCents=balance(owner,'money').available,availablePublications=balance(owner,'publications').available
    const problems=[]
    if(requiredCents>availableCents)problems.push(`余额不足：需${(requiredCents/100).toFixed(2)}元，可用${(availableCents/100).toFixed(2)}元，差${((requiredCents-availableCents)/100).toFixed(2)}元`)
    if(requiredPublications>availablePublications)problems.push(`发布额度不足：需${requiredPublications}篇，可用${availablePublications}篇，差${requiredPublications-availablePublications}篇`)
    return {requiredCents,requiredPublications,availableCents,availablePublications,reason:problems.join('；')}
  }
  return {
    funding(owner,ids){if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length)fail(400,'请选择订单');return funding(owner,ids.map(id=>row(owner,id)))},
    publicAsset(token){
      if(!/^[a-f0-9]{64}$/.test(token))return null
      const found=sql.prepare("SELECT a.value FROM news_orders n,json_each(n.data,'$.assets') a WHERE n.state IN ('scheduled','sending','uncertain','submitted','linked','refunded') AND json_extract(a.value,'$.token')=? LIMIT 1").get(token)
      return found?JSON.parse(found.value):null
    },
    list(owner){return sql.prepare('SELECT * FROM news_orders WHERE owner=? ORDER BY rowid DESC').all(owner).map(r=>safe({...r,data:JSON.parse(r.data)})).filter(r=>!r.deletedAt)},
    expireStale(owner,now=Date.now(),ageMs=stalePublicationAgeMs){return transact(()=>{
      const rows=sql.prepare("SELECT * FROM news_orders WHERE owner=? AND state IN ('quoted','scheduled','reserved','sending','uncertain','submitted')").all(owner)
      const expired=[]
      for(const raw of rows){
        const r={...raw,data:JSON.parse(raw.data)}
        if(r.data.deletedAt||r.data.url)continue
        const started=Date.parse(r.data.acceptedAt||r.data.startedAt||r.data.scheduledAt||r.data.createdAt||'')
        if(!Number.isFinite(started)||now-started<ageMs)continue
        if(['quoted','scheduled'].includes(r.state)){
          cancelUncharged(r,'超过48小时未发布成功，系统自动按发布失败处理')
          expired.push(safe(r))
          continue
        }
        if(['reserved','sending','uncertain'].includes(r.state)&&!r.data.orderId){
          refundReserved(r,'超时失败退回','超过48小时未发布成功，系统自动按发布失败退回')
          expired.push(safe(r))
          continue
        }
        if(r.state==='submitted'){
          refundAccepted(r,'超时失败退款','超过48小时未发布成功，系统自动按发布失败退款')
          expired.push(safe(r))
        }
      }
      return expired
    })},
    expireAllStale(now=Date.now(),ageMs=stalePublicationAgeMs){
      const owners=sql.prepare("SELECT DISTINCT owner FROM news_orders WHERE state IN ('quoted','scheduled','reserved','sending','uncertain','submitted')").all().map(r=>r.owner)
      return owners.flatMap(owner=>this.expireStale(owner,now,ageMs))
    },
    delete(owner,id){return transact(()=>{
      const r=row(owner,id)
      if(r.data.deletedAt)return safe(r)
      if(!['quoted','scheduled','reserved','cancelled','linked','refunded'].includes(r.state))fail(409,'投稿正在处理或结果待核实，请核实完成后再删除')
      if(r.state==='reserved'){entry(r,'money',r.data.priceCents,'取消退回');entry(r,'publications',1,'取消退回')}
      if(['quoted','scheduled','reserved'].includes(r.state))r.state='cancelled'
      r.data.deletedAt=new Date().toISOString();save(r);return safe(r)
    })},
    fail(owner,id,reason='人工确认投稿失败，退回预占'){return transact(()=>{
      const r=row(owner,id)
      if(!['reserved','sending','uncertain'].includes(r.state) || r.data.orderId)fail(409,'已有平台订单号或状态不可直接失败，请先刷新平台状态')
      if(['reserved','sending','uncertain'].includes(r.state)){
        entry(r,'money',r.data.priceCents,'失败退回');entry(r,'publications',1,'失败退回')
      }
      r.state='refunded'
      r.data.rejection=String(reason||'人工确认投稿失败，退回预占').slice(0,300)
      r.data.checkedAt=new Date().toISOString()
      save(r);return safe(r)
    })},
    quote(owner,brand,items,requestId){
      if(!/^[\w-]{8,100}$/.test(requestId||''))fail(400,'发布请求编号无效')
      if(!items.length)fail(400,'请选择文章和媒体')
      return transact(()=>{
        const prefix=`${owner}:${requestId}:`
        const previous=sql.prepare('SELECT * FROM news_orders WHERE owner=? AND substr(request_key,1,?)=? ORDER BY rowid').all(owner,prefix.length,prefix)
        if(previous.length){
          if(previous.length!==items.length||previous.some((r,i)=>{const d=JSON.parse(r.data);return d.brand!==brand||Object.keys(items[i]).some(k=>JSON.stringify(d[k])!==JSON.stringify(items[i][k]))}))fail(409,'发布请求编号已用于其他内容')
          return previous.map(r=>safe({...r,data:JSON.parse(r.data)}))
        }
        return items.map((item,i)=>{
          if(!Number.isSafeInteger(item.priceCents)||item.priceCents<0)fail(400,'报价无效')
          const id=randomUUID(),data={...item,brand,publishBatchId:requestId,createdAt:new Date().toISOString(),expiresAt:Date.now()+300000}
          sql.prepare('INSERT INTO news_orders VALUES(?,?,?,?,?)').run(id,owner,prefix+i,'quoted',JSON.stringify(data))
          return {id,...data,state:'quoted'}
        })
      })
    },
    schedule(owner,ids,scheduledAt,options={}){
      return transact(()=>{
        if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length)fail(400,'请选择订单')
        const time=Date.parse(scheduledAt)
        if(!Number.isFinite(time)||time<Date.now()-60000)fail(400,'预约时间无效')
        const rows=ids.map(id=>row(owner,id))
        for(const r of rows){
          if(r.state!=='quoted')fail(409,'只能预约尚未提交的发布稿')
          r.state='scheduled'
          r.data.scheduledAt=new Date(time).toISOString()
          r.data.queueMode='scheduled'
          r.data.failurePolicy={retryWithNewArticle:options.retryWithNewArticle!==false,maxRetry:Number.isSafeInteger(options.maxRetry)?options.maxRetry:1}
          r.data.expiresAt=Math.max(Number(r.data.expiresAt)||0,time+24*60*60*1000)
          save(r)
        }
        return rows.map(safe)
      })
    },
    dueScheduled(owner,now=Date.now(),limit=20){
      return sql.prepare("SELECT * FROM news_orders WHERE owner=? AND state='scheduled' ORDER BY json_extract(data,'$.scheduledAt'), rowid LIMIT ?").all(owner,Math.max(1,Math.min(100,limit))).map(r=>safe({...r,data:JSON.parse(r.data)})).filter(r=>{
        const time=Date.parse(r.scheduledAt||'')
        return Number.isFinite(time)&&time<=now&&!r.deletedAt
      })
    },
    reserve(owner,ids){return transact(()=>{
      if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length)fail(400,'请选择订单')
      const rows=ids.map(id=>row(owner,id))
      const check=funding(owner,rows);if(check.reason)fail(409,check.reason)
      for(const r of rows){
        if(!['quoted','scheduled'].includes(r.state))continue
        if(r.state==='quoted'&&r.data.expiresAt<Date.now())fail(409,'报价已过期，请重新确认')
        const m=sql.prepare('SELECT data FROM memberships WHERE owner=?').get(owner)
        if(m && Date.parse(JSON.parse(m.data).expiresAt)<=Date.now())fail(403,'套餐已到期')
        entry(r,'money',-r.data.priceCents,'预占');entry(r,'publications',-1,'预占')
        r.data.startedAt=new Date().toISOString()
        r.state='reserved';save(r)
      }
      return rows.map(safe)
    })},
    requeue(owner,id){return transact(()=>{
      const r=row(owner,id)
      if(r.state!=='uncertain' || r.data.orderId)fail(409,'只有无平台订单号的待核实记录可以重新提交')
      r.state='reserved'
      r.data.rejection='已重新提交，等待平台返回订单号'
      r.data.checkedAt=new Date().toISOString()
      save(r);return safe(r)
    })},
    claim(owner,id){return transact(()=>{const r=row(owner,id);if(r.state!=='reserved')return null;r.state='sending';save(r);return safe(r)})},
    accepted(owner,id,orderId){return transact(()=>{
      const r=row(owner,id);if(r.state!=='sending')return
      r.state='submitted';r.data.orderId=orderId;r.data.acceptedAt=new Date().toISOString()
      for(const [resource,quantity] of [['money',r.data.priceCents],['publications',1]])sql.prepare('UPDATE wallets SET used=used+? WHERE owner=? AND resource=?').run(quantity,owner,resource)
      save(r)
    })},
    uncertain(owner,id,message='投稿结果待核实，请勿重复提交'){const r=row(owner,id);if(r.state==='sending'){r.state='uncertain';r.data.rejection=String(message).slice(0,300);save(r)}},
    detail(owner,id,detail){return transact(()=>{
      const r=row(owner,id)
      if(!r.data.orderId||String(detail.order_nid)!==r.data.orderId)fail(502,'平台订单不匹配')
      r.data.providerStatus=detail.status;r.data.providerMessage=String(detail.message||'');r.data.rejection=String(detail.rejection_info||'');r.data.refundInfo=String(detail.refund_info||'')
      // A confirmed refund is idempotent. A rejection alone is not proof of refund.
      if(Number(detail.is_refund)===1 && r.state!=='refunded'){
        refundAccepted(r,'退款',r.data.rejection||'平台确认退款')
      }
      const link=detail.url||detail.link||detail.publish_url||detail.order_url
      if(link){try{const u=new URL(link);if(['https:','http:'].includes(u.protocol))r.data.url=u.href}catch{}}
      if(r.state==='submitted' && r.data.url)r.state='linked'
      r.data.checkedAt=new Date().toISOString();save(r);return safe(r)
    })},
    cancel(owner,id){return transact(()=>{const r=row(owner,id);if(!['quoted','scheduled','reserved'].includes(r.state))fail(409,'已发起投稿，不能在本地取消');if(r.state==='reserved'){entry(r,'money',r.data.priceCents,'取消退回');entry(r,'publications',1,'取消退回')}r.state='cancelled';save(r);return safe(r)})},
    get(owner,id){return safe(row(owner,id))}
  }
}
