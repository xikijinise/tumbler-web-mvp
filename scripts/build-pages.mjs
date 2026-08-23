import { access, cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const projectRoot = resolve(import.meta.dirname, "..");
const clientDirectory = join(projectRoot, "dist", "client");
const serverEntry = join(projectRoot, "dist", "server", "index.js");
const pagesDirectory = join(projectRoot, "dist", "pages");

function normalizeBasePath(value) {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") return "/";
  return `/${trimmed.replace(/^\/+|\/+$/g, "")}/`;
}

const repositoryName = process.env.GITHUB_REPOSITORY?.split("/").pop() ?? "tumbler-web-mvp";
const basePath = normalizeBasePath(process.env.PAGES_BASE ?? `/${repositoryName}/`);
const assetPrefix = basePath === "/" ? "/" : basePath;

await access(clientDirectory);
await access(serverEntry);
await rm(pagesDirectory, { recursive: true, force: true });
await mkdir(pagesDirectory, { recursive: true });
await cp(clientDirectory, pagesDirectory, { recursive: true });

const { default: worker } = await import(`${pathToFileURL(serverEntry).href}?pages=${Date.now()}`);
const response = await worker.fetch(
  new Request("http://localhost/", { headers: { accept: "text/html" } }),
  {
    ASSETS: {
      fetch: async () => new Response("Not found", { status: 404 }),
    },
  },
  {
    waitUntil() {},
    passThroughOnException() {},
  },
);

if (!response.ok) {
  throw new Error(`Static page render failed with HTTP ${response.status}`);
}

let html = await response.text();
html = html.replace(
  /(\b(?:href|src|data-rsc-css-href)=["'])\/(?!\/)/g,
  `$1${assetPrefix}`,
);
html = html.replace(
  /(?<![A-Za-z0-9_-])\/_next\//g,
  `${assetPrefix}_next/`,
);
html = html.replace(
  /(?<![A-Za-z0-9_-])\/(favicon\.svg|file\.svg|globe\.svg|window\.svg|tumbler-real\.png)/g,
  `${assetPrefix}$1`,
);

await writeFile(join(pagesDirectory, "index.html"), html, "utf8");
await writeFile(join(pagesDirectory, ".nojekyll"), "", "utf8");

console.log(`GitHub Pages artifact ready: ${pagesDirectory}`);
console.log(`Base path: ${basePath}`);
