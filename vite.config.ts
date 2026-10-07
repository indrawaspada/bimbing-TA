import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cpSync, createReadStream, existsSync, mkdirSync } from "node:fs";
import { resolve, basename } from "node:path";
import { fileURLToPath, URL } from "node:url";

// PDF.js companion assets stay on the app origin, including CMaps, fonts and
// image-decoding WASM. Nothing is fetched from a third-party CDN.
const pdfAssets = () => {
  let out = "dist";
  const source = resolve("node_modules/pdfjs-dist");
  const groups = ["cmaps", "standard_fonts", "wasm"];
  return {
    name: "local-pdf-assets",
    configResolved(config: any) {
      out = config.build.outDir;
    },
    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: any) => {
        const path = (req.url || "").split("?")[0];
        const match = /^\/pdfjs\/(cmaps|standard_fonts|wasm)\/([^/]+)$/.exec(
          path,
        );
        if (
          !match ||
          basename(match[2]) !== match[2] ||
          match[2].includes("..")
        )
          return next();
        const file = resolve(source, match[1], match[2]);
        if (!existsSync(file)) return next();
        res.setHeader(
          "Content-Type",
          match[2].endsWith(".wasm")
            ? "application/wasm"
            : "application/octet-stream",
        );
        createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      mkdirSync(resolve(out, "pdfjs"), { recursive: true });
      for (const group of groups)
        cpSync(resolve(source, group), resolve(out, "pdfjs", group), {
          recursive: true,
        });
      cpSync(resolve(source, "LICENSE"), resolve(out, "pdfjs/LICENSE"));
    },
  };
};
export default defineConfig({
  plugins: [react(), pdfAssets()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: { outDir: "dist", sourcemap: false, chunkSizeWarningLimit: 900 },
  server: { host: "0.0.0.0" },
});
