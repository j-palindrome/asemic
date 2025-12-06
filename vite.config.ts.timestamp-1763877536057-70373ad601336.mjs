// vite.config.ts
import { defineConfig } from "file:///Users/jpalindrome/Documents/GitHub/asemic/node_modules/.pnpm/vite@5.4.20_@types+node@24.3.1_lightningcss@1.30.1/node_modules/vite/dist/node/index.js";
import react from "file:///Users/jpalindrome/Documents/GitHub/asemic/node_modules/.pnpm/@vitejs+plugin-react@4.7.0_vite@5.4.20_@types+node@24.3.1_lightningcss@1.30.1_/node_modules/@vitejs/plugin-react/dist/index.js";
import { resolve } from "path";
import tailwindcss from "file:///Users/jpalindrome/Documents/GitHub/asemic/node_modules/.pnpm/@tailwindcss+vite@4.1.13_vite@5.4.20_@types+node@24.3.1_lightningcss@1.30.1_/node_modules/@tailwindcss/vite/dist/index.mjs";
import { lezer } from "file:///Users/jpalindrome/Documents/GitHub/asemic/node_modules/.pnpm/@lezer+generator@1.8.0/node_modules/@lezer/generator/dist/rollup-plugin-lezer.js";
import wasm from "file:///Users/jpalindrome/Documents/GitHub/asemic/node_modules/.pnpm/vite-plugin-wasm@3.5.0_vite@5.4.20_@types+node@24.3.1_lightningcss@1.30.1_/node_modules/vite-plugin-wasm/exports/import.mjs";
var __vite_injected_original_dirname = "/Users/jpalindrome/Documents/GitHub/asemic";
var host = process.env.TAURI_DEV_HOST;
var vite_config_default = defineConfig({
  plugins: [react(), tailwindcss(), lezer()],
  worker: { plugins: () => [wasm()] },
  build: {
    sourcemap: true,
    target: "es2020"
  },
  resolve: {
    alias: {
      "@": resolve(__vite_injected_original_dirname, "./src")
    }
  },
  clearScreen: false,
  server: {
    host: host || false,
    // port: 5473,
    strictPort: true
    // hmr: host
    //   ? {
    //       protocol: 'ws',
    //       host,
    //       port: 1421
    //     }
    //   : undefined
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvVXNlcnMvanBhbGluZHJvbWUvRG9jdW1lbnRzL0dpdEh1Yi9hc2VtaWNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIi9Vc2Vycy9qcGFsaW5kcm9tZS9Eb2N1bWVudHMvR2l0SHViL2FzZW1pYy92aXRlLmNvbmZpZy50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vVXNlcnMvanBhbGluZHJvbWUvRG9jdW1lbnRzL0dpdEh1Yi9hc2VtaWMvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJ1xuaW1wb3J0IHJlYWN0IGZyb20gJ0B2aXRlanMvcGx1Z2luLXJlYWN0J1xuaW1wb3J0IGVsZWN0cm9uIGZyb20gJ3ZpdGUtcGx1Z2luLWVsZWN0cm9uL3NpbXBsZSdcbmltcG9ydCB7IHJlc29sdmUgfSBmcm9tICdwYXRoJ1xuaW1wb3J0IHRhaWx3aW5kY3NzIGZyb20gJ0B0YWlsd2luZGNzcy92aXRlJ1xuaW1wb3J0IHsgbGV6ZXIgfSBmcm9tICdAbGV6ZXIvZ2VuZXJhdG9yL3JvbGx1cCdcbmltcG9ydCB3YXNtIGZyb20gJ3ZpdGUtcGx1Z2luLXdhc20nXG5pbXBvcnQgdG9wTGV2ZWxBd2FpdCBmcm9tICd2aXRlLXBsdWdpbi10b3AtbGV2ZWwtYXdhaXQnXG5cbmNvbnN0IGhvc3QgPSBwcm9jZXNzLmVudi5UQVVSSV9ERVZfSE9TVFxuXG4vLyBodHRwczovL3ZpdGVqcy5kZXYvY29uZmlnL1xuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgcGx1Z2luczogW3JlYWN0KCksIHRhaWx3aW5kY3NzKCksIGxlemVyKCldLFxuICB3b3JrZXI6IHsgcGx1Z2luczogKCkgPT4gW3dhc20oKV0gfSxcbiAgYnVpbGQ6IHtcbiAgICBzb3VyY2VtYXA6IHRydWUsXG4gICAgdGFyZ2V0OiAnZXMyMDIwJ1xuICB9LFxuICByZXNvbHZlOiB7XG4gICAgYWxpYXM6IHtcbiAgICAgICdAJzogcmVzb2x2ZShfX2Rpcm5hbWUsICcuL3NyYycpXG4gICAgfVxuICB9LFxuICBjbGVhclNjcmVlbjogZmFsc2UsXG4gIHNlcnZlcjoge1xuICAgIGhvc3Q6IGhvc3QgfHwgZmFsc2UsXG4gICAgLy8gcG9ydDogNTQ3MyxcbiAgICBzdHJpY3RQb3J0OiB0cnVlXG4gICAgLy8gaG1yOiBob3N0XG4gICAgLy8gICA/IHtcbiAgICAvLyAgICAgICBwcm90b2NvbDogJ3dzJyxcbiAgICAvLyAgICAgICBob3N0LFxuICAgIC8vICAgICAgIHBvcnQ6IDE0MjFcbiAgICAvLyAgICAgfVxuICAgIC8vICAgOiB1bmRlZmluZWRcbiAgfVxufSlcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBZ1QsU0FBUyxvQkFBb0I7QUFDN1UsT0FBTyxXQUFXO0FBRWxCLFNBQVMsZUFBZTtBQUN4QixPQUFPLGlCQUFpQjtBQUN4QixTQUFTLGFBQWE7QUFDdEIsT0FBTyxVQUFVO0FBTmpCLElBQU0sbUNBQW1DO0FBU3pDLElBQU0sT0FBTyxRQUFRLElBQUk7QUFHekIsSUFBTyxzQkFBUSxhQUFhO0FBQUEsRUFDMUIsU0FBUyxDQUFDLE1BQU0sR0FBRyxZQUFZLEdBQUcsTUFBTSxDQUFDO0FBQUEsRUFDekMsUUFBUSxFQUFFLFNBQVMsTUFBTSxDQUFDLEtBQUssQ0FBQyxFQUFFO0FBQUEsRUFDbEMsT0FBTztBQUFBLElBQ0wsV0FBVztBQUFBLElBQ1gsUUFBUTtBQUFBLEVBQ1Y7QUFBQSxFQUNBLFNBQVM7QUFBQSxJQUNQLE9BQU87QUFBQSxNQUNMLEtBQUssUUFBUSxrQ0FBVyxPQUFPO0FBQUEsSUFDakM7QUFBQSxFQUNGO0FBQUEsRUFDQSxhQUFhO0FBQUEsRUFDYixRQUFRO0FBQUEsSUFDTixNQUFNLFFBQVE7QUFBQTtBQUFBLElBRWQsWUFBWTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsRUFRZDtBQUNGLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
