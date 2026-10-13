import {useEffect,type ComponentProps} from 'react'
import {MediaWorkspace} from './MediaWorkspace'
import {SocialPublisher} from './SocialPublisher'
export function SocialChannel(props:ComponentProps<typeof MediaWorkspace>) {
  const executionClient=Boolean(window.geoSocialClient)
  useEffect(()=>{
    if(!executionClient)return
    document.body.classList.add('geo-social-client-shell')
    return()=>document.body.classList.remove('geo-social-client-shell')
  },[executionClient])
  if(executionClient)return <main className="geo-social-client-page"><SocialPublisher brand={props.brand} executionOnly /></main>
  return <SocialPublisher brand={props.brand}/>
}
