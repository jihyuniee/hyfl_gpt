#!/usr/bin/env node
/**
 * Dependency-free local runner and public-asset builder.
 * API requests use the real Vercel handlers and real configured storage.
 * There is deliberately no local authentication, data, or AI memory mock.
 */
import { createServer } from 'node:http';
import { readFile, stat, realpath, readdir, mkdir, rm, copyFile } from 'node:fs/promises';
import { dirname, resolve, join, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const API_ROUTES = new Map([
  ['/api/studio', 'api/studio.js'],
  ['/api/ai', 'api/ai.js'],
]);
const LEGACY_API = /^\/api\/(?:chat|stream|teams|conversations)(?:\.js)?\/?$/;
const REQUIRED_PUBLIC_FILES = ['index.html', 'lib/curriculum.mjs', 'lib/workspace.mjs'];
const OPTIONAL_PUBLIC_FILES = ['favicon.ico', 'favicon.svg', 'robots.txt', 'manifest.webmanifest'];
const PUBLIC_FILES = new Set([...REQUIRED_PUBLIC_FILES, ...OPTIONAL_PUBLIC_FILES]);
const MIME_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
});

function isPublicFile(path) {
  if (PUBLIC_FILES.has(path)) return true;
  return path.startsWith('assets/')
    && !path.split('/').some(part => !part || part.startsWith('.'))
    && Object.hasOwn(MIME_TYPES, extname(path).toLowerCase());
}

/** Read only the single global header rule used by Vercel. */
async function securityHeaders(root) {
  const config = JSON.parse(await readFile(join(root, 'vercel.json'), 'utf8'));
  const rule = config.routes?.find(route => route.src === '/.*' && route.continue === true);
  if (!rule?.headers?.['Content-Security-Policy']) {
    throw new Error('vercel.json의 공통 보안 헤더를 확인해주세요.');
  }
  return rule.headers;
}

function respondJson(res, statusCode, value) {
  if (res.writableEnded) return res;
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, private');
  res.end(JSON.stringify(value));
  return res;
}

function adaptResponse(res) {
  res.status = statusCode => { res.statusCode = statusCode; return res; };
  res.json = value => respondJson(res, res.statusCode, value);
  res.send = value => {
    if (typeof value === 'object' && value !== null && !Buffer.isBuffer(value)) return res.json(value);
    if (!res.writableEnded) res.end(value ?? '');
    return res;
  };
  return res;
}

/** Check the raw request path before URL normalization can hide traversal. */
function requestPath(rawUrl) {
  const rawPath = String(rawUrl || '/').split('?')[0];
  if (!rawPath.startsWith('/') || rawPath.startsWith('//')) return null;
  let pathname;
  try { pathname = decodeURIComponent(rawPath); } catch { return null; }
  if (/[\\\u0000-\u001f\u007f%]/.test(pathname) || pathname.includes('//')) return null;
  if (pathname.split('/').some(part => part.startsWith('.'))) return null;
  return pathname;
}

/** Reject symlinks as well as paths outside the project. */
async function safeFile(root, relativePath) {
  const expected = resolve(root, relativePath);
  if (!expected.startsWith(root + sep)) return null;
  let actual;
  try { actual = await realpath(expected); } catch { return null; }
  if (actual !== expected || !actual.startsWith(root + sep)) return null;
  const info = await stat(actual);
  return info.isFile() ? { path: actual, size: info.size } : null;
}

export async function createDevServer({ root = PROJECT_ROOT } = {}) {
  const projectRoot = await realpath(root);
  const headers = await securityHeaders(projectRoot);
  const handlers = new Map();

  const server = createServer(async (req, res) => {
    for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
    const pathname = requestPath(req.url);
    if (pathname === null) return respondJson(res, 404, { code: 'NOT_FOUND', error: '요청한 경로를 찾을 수 없습니다.' });

    try {
      if (LEGACY_API.test(pathname)) {
        return respondJson(res, 410, { code: 'ENDPOINT_RETIRED', error: '이전 API는 종료되었습니다. 새 코딩 작업 공간을 이용해주세요.' });
      }

      if (pathname === '/api' || pathname.startsWith('/api/')) {
        const canonical = pathname.replace(/\/$/, '').replace(/\.js$/, '');
        const handlerPath = API_ROUTES.get(canonical);
        if (!handlerPath) return respondJson(res, 404, { code: 'NOT_FOUND', error: 'API 경로를 찾을 수 없습니다.' });

        if (!handlers.has(handlerPath)) {
          const file = await safeFile(projectRoot, handlerPath);
          if (!file) return respondJson(res, 503, { code: 'API_NOT_READY', error: '서버 API 파일이 아직 준비되지 않았습니다.' });
          const module = await import(pathToFileURL(file.path).href);
          if (typeof module.default !== 'function') throw new Error('Invalid API handler');
          handlers.set(handlerPath, module.default);
        }

        const url = new URL(req.url, 'http://localhost');
        req.query = Object.fromEntries(url.searchParams);
        // Leave req.body undefined: the actual API reader enforces its byte limit.
        await handlers.get(handlerPath)(req, adaptResponse(res));
        if (!res.writableEnded && !res.headersSent) {
          respondJson(res, 500, { code: 'EMPTY_API_RESPONSE', error: '서버가 응답을 완료하지 못했습니다.' });
        }
        return;
      }

      if (!['GET', 'HEAD'].includes(req.method)) {
        res.setHeader('Allow', 'GET, HEAD');
        return respondJson(res, 405, { code: 'METHOD_NOT_ALLOWED', error: '이 경로는 조회만 할 수 있습니다.' });
      }

      const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
      if (!isPublicFile(relativePath)) return respondJson(res, 404, { code: 'NOT_FOUND', error: '요청한 파일을 찾을 수 없습니다.' });
      const file = await safeFile(projectRoot, relativePath);
      if (!file) return respondJson(res, 404, { code: 'NOT_FOUND', error: '요청한 파일을 찾을 수 없습니다.' });

      res.statusCode = 200;
      res.setHeader('Content-Type', MIME_TYPES[extname(relativePath).toLowerCase()]);
      res.setHeader('Content-Length', file.size);
      if (req.method === 'HEAD') return res.end();
      res.end(await readFile(file.path));
    } catch (error) {
      // Never print request bodies, cookies, environment values, or provider errors.
      console.error('Request failed:', error?.code || error?.name || 'Error');
      if (!res.headersSent) respondJson(res, 500, { code: 'INTERNAL_ERROR', error: '요청을 처리하지 못했습니다. 서버 설정을 확인해주세요.' });
      else if (!res.writableEnded) res.end();
    }
  });
  server.requestTimeout = 125_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  return server;
}

async function walkFiles(root, subdirectory) {
  const result = [];
  async function walk(current) {
    let entries;
    try { entries = await readdir(join(root, current), { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const path = current ? `${current}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) result.push(path);
    }
  }
  await walk(subdirectory);
  return result.sort();
}

/** Publish only the browser surface; API dependencies remain server bundles. */
export async function buildStatic(root = PROJECT_ROOT) {
  const projectRoot = await realpath(root);
  const publicFiles = [];
  for (const path of REQUIRED_PUBLIC_FILES) {
    const file = await safeFile(projectRoot, path);
    if (!file) throw new Error(`공개 빌드에 필요한 파일이 없습니다: ${path}`);
    publicFiles.push(path);
  }
  for (const path of OPTIONAL_PUBLIC_FILES) {
    if (await safeFile(projectRoot, path)) publicFiles.push(path);
  }
  for (const path of await walkFiles(projectRoot, 'assets')) {
    if (isPublicFile(path) && await safeFile(projectRoot, path)) publicFiles.push(path);
  }

  const output = join(projectRoot, 'dist');
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  for (const path of publicFiles) {
    const destination = join(output, path);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(join(projectRoot, path), destination);
  }
  console.log(`Public build: ${publicFiles.length} files → dist`);
  return publicFiles;
}

async function checkSyntax(root = PROJECT_ROOT) {
  const files = (await Promise.all(['api', 'lib', 'assets', 'scripts', 'tests'].map(path => walkFiles(root, path))))
    .flat().filter(path => /\.(?:mjs|js)$/.test(path));
  for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', join(root, file)], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`${file}\n${result.stderr || result.error?.message || 'Syntax check failed'}`);
  }
  const html = await readFile(join(root, 'index.html'), 'utf8');
  let inlineCount = 0;
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attributes = match[1];
    if (/\bsrc\s*=/i.test(attributes) || !match[2].trim()) continue;
    const type = attributes.match(/\btype\s*=\s*["']?([^\s"'>]+)/i)?.[1]?.toLowerCase();
    if (type && !['module', 'text/javascript', 'application/javascript'].includes(type)) continue;
    const flags = ['--check'];
    if (type === 'module') flags.push('--input-type=module');
    const result = spawnSync(process.execPath, flags, { input: match[2], encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`index.html inline script ${inlineCount + 1}\n${result.stderr || 'Syntax check failed'}`);
    inlineCount += 1;
  }
  for (const file of ['package.json', 'vercel.json']) JSON.parse(await readFile(join(root, file), 'utf8'));
  console.log(`Syntax OK: ${files.length} JavaScript files, ${inlineCount} inline scripts, 2 JSON configs`);
}

function option(args, name, fallback) {
  const index = args.indexOf(name);
  if (index !== -1) return args[index + 1];
  return args.find(arg => arg.startsWith(`${name}=`))?.slice(name.length + 1) ?? fallback;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--build')) return buildStatic();
  if (args.includes('--check')) return checkSyntax();
  const port = Number(option(args, '--port', process.env.HYFL_DEV_PORT || process.env.PORT || '3000'));
  const host = option(args, '--host', process.env.HYFL_DEV_HOST || '127.0.0.1');
  if (!Number.isInteger(port) || port < 0 || port > 65535 || !host) throw new Error('유효한 --host와 --port를 지정해주세요.');
  const server = await createDevServer();
  server.on('error', error => { console.error('Dev server:', error.code || error.name); process.exitCode = 1; });
  server.listen(port, host, () => {
    const bound = server.address();
    const displayHost = host.includes(':') ? `[${host}]` : host;
    console.log(`HYFL Studio: http://${displayHost}:${bound.port}`);
    console.log('API uses the real handlers and configured environment. Restart after server-code changes.');
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => { server.close(); server.closeIdleConnections(); });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
