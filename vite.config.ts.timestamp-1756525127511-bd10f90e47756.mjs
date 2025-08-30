// vite.config.ts
import { defineConfig } from "file:///Users/jpalindrome/Documents/asemic/node_modules/.pnpm/vite@5.4.19_@types+node@24.0.3_lightningcss@1.30.1/node_modules/vite/dist/node/index.js";
import react from "file:///Users/jpalindrome/Documents/asemic/node_modules/.pnpm/@vitejs+plugin-react@4.5.2_vite@5.4.19_@types+node@24.0.3_lightningcss@1.30.1_/node_modules/@vitejs/plugin-react/dist/index.mjs";
import electron from "file:///Users/jpalindrome/Documents/asemic/node_modules/.pnpm/vite-plugin-electron@0.29.0_vite-plugin-electron-renderer@0.14.6/node_modules/vite-plugin-electron/dist/simple.mjs";
import { resolve } from "path";
import tailwindcss from "file:///Users/jpalindrome/Documents/asemic/node_modules/.pnpm/@tailwindcss+vite@4.1.10_vite@5.4.19_@types+node@24.0.3_lightningcss@1.30.1_/node_modules/@tailwindcss/vite/dist/index.mjs";
var __vite_injected_original_dirname = "/Users/jpalindrome/Documents/asemic";
var vite_config_default = defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    electron({
      main: {
        // Shortcut of `build.lib.entry`.
        entry: "electron/main.ts",
        vite: {
          build: {
            sourcemap: "inline",
            rollupOptions: {
              external: [
                "node-osc",
                "sharp",
                "supercolliderjs",
                "ws",
                "socket.io",
                "engine.io",
                "engine.io-client",
                "utf-8-validate",
                "bufferutil"
              ]
            }
          }
        }
      },
      preload: {
        // Shortcut of `build.rollupOptions.input`.
        // Preload scripts may contain Web APIs, so use the `build.rollupOptions.input` instead `build.lib.entry`.
        input: "electron/preload.ts"
      }
    })
  ],
  build: {
    sourcemap: true,
    target: "es2020"
  },
  resolve: {
    alias: {
      "@": resolve(__vite_injected_original_dirname, "./src")
    }
  },
  server: {
    port: 5173
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvVXNlcnMvanBhbGluZHJvbWUvRG9jdW1lbnRzL2FzZW1pY1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiL1VzZXJzL2pwYWxpbmRyb21lL0RvY3VtZW50cy9hc2VtaWMvdml0ZS5jb25maWcudHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL1VzZXJzL2pwYWxpbmRyb21lL0RvY3VtZW50cy9hc2VtaWMvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJ1xuaW1wb3J0IHJlYWN0IGZyb20gJ0B2aXRlanMvcGx1Z2luLXJlYWN0J1xuaW1wb3J0IGVsZWN0cm9uIGZyb20gJ3ZpdGUtcGx1Z2luLWVsZWN0cm9uL3NpbXBsZSdcbmltcG9ydCB7IHJlc29sdmUgfSBmcm9tICdwYXRoJ1xuaW1wb3J0IHRhaWx3aW5kY3NzIGZyb20gJ0B0YWlsd2luZGNzcy92aXRlJ1xuXG4vLyBodHRwczovL3ZpdGVqcy5kZXYvY29uZmlnL1xuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgcGx1Z2luczogW1xuICAgIHJlYWN0KCksXG4gICAgdGFpbHdpbmRjc3MoKSxcblxuICAgIGVsZWN0cm9uKHtcbiAgICAgIG1haW46IHtcbiAgICAgICAgLy8gU2hvcnRjdXQgb2YgYGJ1aWxkLmxpYi5lbnRyeWAuXG4gICAgICAgIGVudHJ5OiAnZWxlY3Ryb24vbWFpbi50cycsXG4gICAgICAgIHZpdGU6IHtcbiAgICAgICAgICBidWlsZDoge1xuICAgICAgICAgICAgc291cmNlbWFwOiAnaW5saW5lJyxcbiAgICAgICAgICAgIHJvbGx1cE9wdGlvbnM6IHtcbiAgICAgICAgICAgICAgZXh0ZXJuYWw6IFtcbiAgICAgICAgICAgICAgICAnbm9kZS1vc2MnLFxuICAgICAgICAgICAgICAgICdzaGFycCcsXG4gICAgICAgICAgICAgICAgJ3N1cGVyY29sbGlkZXJqcycsXG4gICAgICAgICAgICAgICAgJ3dzJyxcbiAgICAgICAgICAgICAgICAnc29ja2V0LmlvJyxcbiAgICAgICAgICAgICAgICAnZW5naW5lLmlvJyxcbiAgICAgICAgICAgICAgICAnZW5naW5lLmlvLWNsaWVudCcsXG4gICAgICAgICAgICAgICAgJ3V0Zi04LXZhbGlkYXRlJyxcbiAgICAgICAgICAgICAgICAnYnVmZmVydXRpbCdcbiAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIHByZWxvYWQ6IHtcbiAgICAgICAgLy8gU2hvcnRjdXQgb2YgYGJ1aWxkLnJvbGx1cE9wdGlvbnMuaW5wdXRgLlxuICAgICAgICAvLyBQcmVsb2FkIHNjcmlwdHMgbWF5IGNvbnRhaW4gV2ViIEFQSXMsIHNvIHVzZSB0aGUgYGJ1aWxkLnJvbGx1cE9wdGlvbnMuaW5wdXRgIGluc3RlYWQgYGJ1aWxkLmxpYi5lbnRyeWAuXG4gICAgICAgIGlucHV0OiAnZWxlY3Ryb24vcHJlbG9hZC50cydcbiAgICAgIH1cbiAgICB9KVxuICBdLFxuICBidWlsZDoge1xuICAgIHNvdXJjZW1hcDogdHJ1ZSxcbiAgICB0YXJnZXQ6ICdlczIwMjAnXG4gIH0sXG4gIHJlc29sdmU6IHtcbiAgICBhbGlhczoge1xuICAgICAgJ0AnOiByZXNvbHZlKF9fZGlybmFtZSwgJy4vc3JjJylcbiAgICB9XG4gIH0sXG4gIHNlcnZlcjoge1xuICAgIHBvcnQ6IDUxNzNcbiAgfVxufSlcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBMlIsU0FBUyxvQkFBb0I7QUFDeFQsT0FBTyxXQUFXO0FBQ2xCLE9BQU8sY0FBYztBQUNyQixTQUFTLGVBQWU7QUFDeEIsT0FBTyxpQkFBaUI7QUFKeEIsSUFBTSxtQ0FBbUM7QUFPekMsSUFBTyxzQkFBUSxhQUFhO0FBQUEsRUFDMUIsU0FBUztBQUFBLElBQ1AsTUFBTTtBQUFBLElBQ04sWUFBWTtBQUFBLElBRVosU0FBUztBQUFBLE1BQ1AsTUFBTTtBQUFBO0FBQUEsUUFFSixPQUFPO0FBQUEsUUFDUCxNQUFNO0FBQUEsVUFDSixPQUFPO0FBQUEsWUFDTCxXQUFXO0FBQUEsWUFDWCxlQUFlO0FBQUEsY0FDYixVQUFVO0FBQUEsZ0JBQ1I7QUFBQSxnQkFDQTtBQUFBLGdCQUNBO0FBQUEsZ0JBQ0E7QUFBQSxnQkFDQTtBQUFBLGdCQUNBO0FBQUEsZ0JBQ0E7QUFBQSxnQkFDQTtBQUFBLGdCQUNBO0FBQUEsY0FDRjtBQUFBLFlBQ0Y7QUFBQSxVQUNGO0FBQUEsUUFDRjtBQUFBLE1BQ0Y7QUFBQSxNQUNBLFNBQVM7QUFBQTtBQUFBO0FBQUEsUUFHUCxPQUFPO0FBQUEsTUFDVDtBQUFBLElBQ0YsQ0FBQztBQUFBLEVBQ0g7QUFBQSxFQUNBLE9BQU87QUFBQSxJQUNMLFdBQVc7QUFBQSxJQUNYLFFBQVE7QUFBQSxFQUNWO0FBQUEsRUFDQSxTQUFTO0FBQUEsSUFDUCxPQUFPO0FBQUEsTUFDTCxLQUFLLFFBQVEsa0NBQVcsT0FBTztBQUFBLElBQ2pDO0FBQUEsRUFDRjtBQUFBLEVBQ0EsUUFBUTtBQUFBLElBQ04sTUFBTTtBQUFBLEVBQ1I7QUFDRixDQUFDOyIsCiAgIm5hbWVzIjogW10KfQo=
