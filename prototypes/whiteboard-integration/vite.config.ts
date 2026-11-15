import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import {createBangMiddleware} from './bridge.mjs';
export default defineConfig({ plugins: [react(), tailwindcss(), {name:'bang-local',configureServer(server){server.middlewares.use(createBangMiddleware())}}], server:{watch:{ignored:['**/evidence/**','**/.bang/**']}} });
