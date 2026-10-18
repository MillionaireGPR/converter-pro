import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { writeFileSync } from "fs";

/**
 * Aviso de atualização (17/10/2026, mesmo padrão da Nunê): cada build grava
 * `dist/build-version.json` com um id e embute o mesmo id no bundle
 * (`__APP_BUILD__`). A tela compara o `/build-version.json` publicado, lido
 * sem cache, com o id embutido — diferentes = saiu versão nova.
 */
function buildVersionFile(buildId: string): Plugin {
  return {
    name: "build-version-file",
    apply: "build",
    writeBundle(options) {
      writeFileSync(path.join(options.dir ?? "dist", "build-version.json"), JSON.stringify({ build: buildId }));
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(() => {
  const buildId = Date.now().toString(36);
  return {
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
    },
    plugins: [react(), buildVersionFile(buildId)],
    define: { __APP_BUILD__: JSON.stringify(buildId) },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
