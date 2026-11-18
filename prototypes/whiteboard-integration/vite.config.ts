import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import {createBangMiddleware} from './bridge.mjs';
import {createCanvasMiddleware} from '../../runtime/canvas/http.mjs';
export default defineConfig(({mode})=>({ plugins: [react(), tailwindcss(), {name:'bang-local',configureServer(server){
 if(process.env.BANG_CANVAS_PROJECT)server.middlewares.use(createCanvasMiddleware({project:process.env.BANG_CANVAS_PROJECT}));
 server.middlewares.use(createBangMiddleware());
 }}],build:{rollupOptions:{input:mode==='packaged'?{canvas:'canvas.html'}:{main:'index.html',canvas:'canvas.html'}}}, server:{watch:{ignored:['**/evidence/**','**/.bang/**']}} }));
