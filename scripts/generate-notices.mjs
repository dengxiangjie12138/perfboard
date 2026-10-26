import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
const lock=JSON.parse(await readFile('package-lock.json','utf8'));
const lines=['Perfboard third-party notices','Generated from installed, locked dependencies. See the included full license texts.',''];
for(const location of Object.keys(lock.packages)){
 if(!location.startsWith('node_modules/'))continue;
 let pkg; try{pkg=JSON.parse(await readFile(join(location,'package.json'),'utf8'))}catch{continue}
 lines.push('=== '+pkg.name+'@'+pkg.version+' ('+(pkg.license??'see license below')+') ===');
 const names=await readdir(location);
 const licenses=names.filter(n=>/^(licen[sc]e|copying|notice|ofl)(\.|$)/i.test(n));
 for(const name of licenses){try{lines.push(await readFile(join(location,name),'utf8'))}catch{/* directories are not license texts */}}
 if(!licenses.length)lines.push('Upstream: '+(typeof pkg.repository==='string'?pkg.repository:pkg.repository?.url??pkg.homepage??'npm package metadata'));
 lines.push('');
}
async function scanFonts(path){for(const entry of await readdir(path,{withFileTypes:true})){const file=join(path,entry.name);if(entry.isDirectory())await scanFonts(file);else if(/licen[sc]e|ofl|notice/i.test(entry.name)){lines.push('=== Font: '+file+' ===',await readFile(file,'utf8'))}}}
await scanFonts('public/fonts');
await scanFonts('public/transformer-design/fonts');
lines.push('=== Official Tiptap Simple Editor UI template (MIT) ===',await readFile('third_party/tiptap-simple-editor/LICENSE','utf8'),'Provenance: third_party/tiptap-simple-editor/PROVENANCE.md');
await writeFile('public/third-party-notices.txt',lines.join('\n').split('\n').map(line=>line.trimEnd()).join('\n').trimEnd()+'\n','utf8');
console.log('Wrote notices for '+(Object.keys(lock.packages).length-1)+' dependency packages.');
