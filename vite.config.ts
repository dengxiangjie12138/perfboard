import { type Plugin } from 'vite';
import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import excalidrawPackage from './node_modules/@excalidraw/excalidraw/package.json' with { type: 'json' };
/** Excalidraw 0.18.1 appends a CDN font source even with local assets.
 * Keep its original editor, Unicode ranges and export code; point only that
 * fallback at bundled fonts. Fail closed if upstream changes. */
function localExcalidrawFonts(): Plugin {
 const version = excalidrawPackage.version;
 if (version !== '0.18.1') throw new Error('Review Excalidraw local font adapter before upgrading '+version);
 let applied = 0;
 return {
  name:'perfboard-local-excalidraw-fonts', enforce:'pre',
  buildStart(){applied=0},
  transform(source,id){
   if(!id.replace(/\\/g,'/').includes('/node_modules/@excalidraw/excalidraw/dist/')||!id.endsWith('.js'))return;
   const pattern=/(["']ASSETS_FALLBACK_URL["']\s*,\s*|ASSETS_FALLBACK_URL\s*=\s*)(\x60https:\/\/esm\.sh\/[\s\S]*?\/dist\/prod\/\x60)/g;
   let count=0;
   const code=source.replace(pattern,(_match,prefix)=>{count++;return prefix+"window.location.origin + '/'";});
   if(count>1)throw new Error('Unexpected Excalidraw fallback declarations');
   if(count){applied+=count;return {code,map:null}};
  },
  buildEnd(error){if(!error&&applied!==1)throw new Error('Excalidraw local font adapter did not match exactly one declaration: '+applied)}
 };
}
export default defineConfig({
 plugins:[localExcalidrawFonts(),react()], clearScreen:false,
 optimizeDeps:{exclude:['@excalidraw/excalidraw']},
 server:{port:1420,strictPort:true},envPrefix:['VITE_','TAURI_'],
 test:{exclude:[...configDefaults.exclude,'PRD/**','.quality/**','third_party/**']},
 build:{target:'es2022',chunkSizeWarningLimit:4000}
});
