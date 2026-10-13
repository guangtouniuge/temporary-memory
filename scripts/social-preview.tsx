import React from 'react'
import {createRoot} from 'react-dom/client'
import {SocialPublisher} from '../src/SocialPublisher'
import '../src/styles.css'
createRoot(document.getElementById('root')!).render(<main style={{padding:'24px',maxWidth:1400,margin:'auto'}}><style>{'body{min-width:0}'}</style><div style={{fontSize:13,color:'#61738b',borderBottom:'1px solid #dce4ee',paddingBottom:16}}>企业家商用后台 / 自媒体渠道 <span style={{float:'right'}}>本地隔离测试</span></div><SocialPublisher brand="本地发布测试"/></main>)
