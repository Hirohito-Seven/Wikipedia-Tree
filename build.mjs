import {mkdir,copyFile,writeFile} from 'node:fs/promises';
const target=new URL('./dist/',import.meta.url);await mkdir(target,{recursive:true});
for(const name of ['index.html','styles.css','app.js','graph.js','wiki.js','favicon.svg'])await copyFile(new URL(name,import.meta.url),new URL(name,target));
await writeFile(new URL('.nojekyll',target),'');console.log('Built static app in dist/');
