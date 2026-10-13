import {build} from 'vite'
await build({configFile:false,define:{'process.env.NODE_ENV':'"production"'},build:{outDir:'desktop-news/renderer',emptyOutDir:false,lib:{entry:'scripts/social-client-entry.tsx',formats:['iife'],name:'GeoSocialClient',fileName:()=> 'social.js',cssFileName:'social'},cssCodeSplit:false}})
