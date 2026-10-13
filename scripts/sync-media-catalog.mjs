import {createMediaCatalog} from '../server/media-catalog.mjs'
const catalog=createMediaCatalog()
for(const channel of ['news','social']){
  const data=await catalog.sync(channel)
  console.log(JSON.stringify({channel,total:data.resources.length,pages20:Math.ceil(data.resources.length/20),updatedAt:data.updatedAt}))
}
