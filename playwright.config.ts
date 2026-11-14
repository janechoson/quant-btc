import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./tests',testMatch:'**/*.ui.spec.ts',fullyParallel:false,reporter:'line',use:{baseURL:'http://localhost:5173',viewport:{width:1672,height:941},trace:'retain-on-failure'},webServer:{command:'npm run dev',url:'http://localhost:5173',reuseExistingServer:!process.env.CI,timeout:60000}});
