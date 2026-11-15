import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
fs.mkdirSync(path.join(root,'public'),{recursive:true});
fs.cpSync(path.join(root,'node_modules/@excalidraw/excalidraw/dist/prod/fonts'),path.join(root,'public/fonts'),{recursive:true});
fs.copyFileSync(path.join(root,'node_modules/elkjs/lib/elk-worker.min.js'),path.join(root,'public/elk-worker.min.js'));
