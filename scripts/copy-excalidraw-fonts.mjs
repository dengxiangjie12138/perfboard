import {cp,mkdir} from 'node:fs/promises';
await mkdir('public/fonts',{recursive:true});
await cp('node_modules/@excalidraw/excalidraw/dist/prod/fonts','public/fonts',{recursive:true});
console.log('Excalidraw fonts copied locally.');
