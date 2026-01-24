// vite.config.ts
import { defineConfig } from "file:///Volumes/jDrive/Code/asemic/node_modules/.pnpm/vite@5.4.20_@types+node@24.3.1_lightningcss@1.30.1/node_modules/vite/dist/node/index.js";
import react from "file:///Volumes/jDrive/Code/asemic/node_modules/.pnpm/@vitejs+plugin-react@4.7.0_vite@5.4.20_@types+node@24.3.1_lightningcss@1.30.1_/node_modules/@vitejs/plugin-react/dist/index.js";
import { resolve } from "path";
import tailwindcss from "file:///Volumes/jDrive/Code/asemic/node_modules/.pnpm/@tailwindcss+vite@4.1.13_vite@5.4.20_@types+node@24.3.1_lightningcss@1.30.1_/node_modules/@tailwindcss/vite/dist/index.mjs";
import { lezer } from "file:///Volumes/jDrive/Code/asemic/node_modules/.pnpm/@lezer+generator@1.8.0/node_modules/@lezer/generator/dist/rollup-plugin-lezer.js";
import wasm from "file:///Volumes/jDrive/Code/asemic/node_modules/.pnpm/vite-plugin-wasm@3.5.0_vite@5.4.20_@types+node@24.3.1_lightningcss@1.30.1_/node_modules/vite-plugin-wasm/exports/import.mjs";
var __vite_injected_original_dirname = "/Volumes/jDrive/Code/asemic";
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
    strictPort: true,
    hmr: host ? {
      protocol: "ws",
      host,
      port: 1421
    } : void 0,
    watch: {
      ignored: ["**/supercollider/**"]
    }
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvVm9sdW1lcy9qRHJpdmUvQ29kZS9hc2VtaWNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIi9Wb2x1bWVzL2pEcml2ZS9Db2RlL2FzZW1pYy92aXRlLmNvbmZpZy50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vVm9sdW1lcy9qRHJpdmUvQ29kZS9hc2VtaWMvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJ1xuaW1wb3J0IHJlYWN0IGZyb20gJ0B2aXRlanMvcGx1Z2luLXJlYWN0J1xuaW1wb3J0IHsgcmVzb2x2ZSB9IGZyb20gJ3BhdGgnXG5pbXBvcnQgdGFpbHdpbmRjc3MgZnJvbSAnQHRhaWx3aW5kY3NzL3ZpdGUnXG5pbXBvcnQgeyBsZXplciB9IGZyb20gJ0BsZXplci9nZW5lcmF0b3Ivcm9sbHVwJ1xuaW1wb3J0IHdhc20gZnJvbSAndml0ZS1wbHVnaW4td2FzbSdcbmltcG9ydCB0b3BMZXZlbEF3YWl0IGZyb20gJ3ZpdGUtcGx1Z2luLXRvcC1sZXZlbC1hd2FpdCdcblxuY29uc3QgaG9zdCA9IHByb2Nlc3MuZW52LlRBVVJJX0RFVl9IT1NUXG5cbi8vIGh0dHBzOi8vdml0ZWpzLmRldi9jb25maWcvXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xuICBwbHVnaW5zOiBbcmVhY3QoKSwgdGFpbHdpbmRjc3MoKSwgbGV6ZXIoKV0sXG4gIHdvcmtlcjogeyBwbHVnaW5zOiAoKSA9PiBbd2FzbSgpXSB9LFxuICBidWlsZDoge1xuICAgIHNvdXJjZW1hcDogdHJ1ZSxcbiAgICB0YXJnZXQ6ICdlczIwMjAnXG4gIH0sXG4gIHJlc29sdmU6IHtcbiAgICBhbGlhczoge1xuICAgICAgJ0AnOiByZXNvbHZlKF9fZGlybmFtZSwgJy4vc3JjJylcbiAgICB9XG4gIH0sXG4gIGNsZWFyU2NyZWVuOiBmYWxzZSxcbiAgc2VydmVyOiB7XG4gICAgaG9zdDogaG9zdCB8fCBmYWxzZSxcbiAgICAvLyBwb3J0OiA1NDczLFxuICAgIHN0cmljdFBvcnQ6IHRydWUsXG4gICAgaG1yOiBob3N0XG4gICAgICA/IHtcbiAgICAgICAgICBwcm90b2NvbDogJ3dzJyxcbiAgICAgICAgICBob3N0LFxuICAgICAgICAgIHBvcnQ6IDE0MjFcbiAgICAgICAgfVxuICAgICAgOiB1bmRlZmluZWQsXG4gICAgd2F0Y2g6IHtcbiAgICAgIGlnbm9yZWQ6IFsnKiovc3VwZXJjb2xsaWRlci8qKiddXG4gICAgfVxuICB9XG59KVxuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUFtUSxTQUFTLG9CQUFvQjtBQUNoUyxPQUFPLFdBQVc7QUFDbEIsU0FBUyxlQUFlO0FBQ3hCLE9BQU8saUJBQWlCO0FBQ3hCLFNBQVMsYUFBYTtBQUN0QixPQUFPLFVBQVU7QUFMakIsSUFBTSxtQ0FBbUM7QUFRekMsSUFBTSxPQUFPLFFBQVEsSUFBSTtBQUd6QixJQUFPLHNCQUFRLGFBQWE7QUFBQSxFQUMxQixTQUFTLENBQUMsTUFBTSxHQUFHLFlBQVksR0FBRyxNQUFNLENBQUM7QUFBQSxFQUN6QyxRQUFRLEVBQUUsU0FBUyxNQUFNLENBQUMsS0FBSyxDQUFDLEVBQUU7QUFBQSxFQUNsQyxPQUFPO0FBQUEsSUFDTCxXQUFXO0FBQUEsSUFDWCxRQUFRO0FBQUEsRUFDVjtBQUFBLEVBQ0EsU0FBUztBQUFBLElBQ1AsT0FBTztBQUFBLE1BQ0wsS0FBSyxRQUFRLGtDQUFXLE9BQU87QUFBQSxJQUNqQztBQUFBLEVBQ0Y7QUFBQSxFQUNBLGFBQWE7QUFBQSxFQUNiLFFBQVE7QUFBQSxJQUNOLE1BQU0sUUFBUTtBQUFBO0FBQUEsSUFFZCxZQUFZO0FBQUEsSUFDWixLQUFLLE9BQ0Q7QUFBQSxNQUNFLFVBQVU7QUFBQSxNQUNWO0FBQUEsTUFDQSxNQUFNO0FBQUEsSUFDUixJQUNBO0FBQUEsSUFDSixPQUFPO0FBQUEsTUFDTCxTQUFTLENBQUMscUJBQXFCO0FBQUEsSUFDakM7QUFBQSxFQUNGO0FBQ0YsQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K
