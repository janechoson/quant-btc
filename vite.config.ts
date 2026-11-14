import {defineConfig} from 'vite';import vue from '@vitejs/plugin-vue';
const apiPort=Number(process.env.API_PORT)||4173;
export default defineConfig({root:'client',plugins:[vue()],server:{port:Number(process.env.VITE_PORT)||5173,strictPort:true,proxy:{'/api':`http://localhost:${apiPort}`}},build:{outDir:'../dist/client',emptyOutDir:true}});
