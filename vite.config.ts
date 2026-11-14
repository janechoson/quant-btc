import {defineConfig} from 'vite';import vue from '@vitejs/plugin-vue';
export default defineConfig({root:'client',plugins:[vue()],server:{port:5173,strictPort:true,proxy:{'/api':'http://localhost:4173'}},build:{outDir:'../dist/client',emptyOutDir:true}});
