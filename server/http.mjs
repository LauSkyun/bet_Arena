import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { durationsFromSeconds } from '../prototype-playtest/timing.mjs';
import { openArena } from './shared-arena.mjs';

const cookieName = 'arena44_session';
const contentTypes = { html: 'text/html', mjs: 'text/javascript', css: 'text/css', json: 'application/json' };
const root = new URL('../prototype-playtest/', import.meta.url);
const assets = new Map([
  ['/', 'shared-login.html'], ['/arena/', 'index.html'], ['/history/', 'shared-history.html'], ['/replay/', 'replay.html'],
]);

function tokenFor(request) {
  const prefix = `${cookieName}=`;
  return request.headers.cookie?.split(/;\s*/).find((entry) => entry.startsWith(prefix))?.slice(prefix.length);
}

function cookie(token, secure) {
  return `${cookieName}=${token ?? ''}; Path=/; Max-Age=${token ? 2_592_000 : 0}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

async function bodyFor(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) return null;
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes <= 4096) chunks.push(chunk);
  }
  if (bytes > 4096) return null;
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { return null; }
}

function numberParam(value, fallback) {
  const number = value == null ? fallback : Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function staticFile(request, response, pathname) {
  let name = assets.get(pathname);
  if (!name && /^\/(?:arena\/|history\/|replay\/)?[a-z0-9-]+\.(?:mjs|css|json)$/.test(pathname)) name = pathname.split('/').at(-1);
  if (!name || name.endsWith('.test.mjs')) return false;
  const file = new URL(name, root);
  if (!existsSync(file)) return false;
  let bytes = readFileSync(file);
  if (pathname === '/arena/') bytes = bytes.toString().replace('<body>', '<body data-shared-arena>');
  response.writeHead(200, { 'Content-Type': `${contentTypes[name.split('.').at(-1)]}; charset=utf-8` });
  response.end(request.method === 'HEAD' ? undefined : bytes);
  return true;
}

export function createArenaServer({ arena, secureCookies = false }) {
  return createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const { pathname, searchParams } = new URL(request.url, 'http://localhost');
      const method = request.method;
      const token = tokenFor(request);
      if (method === 'POST') {
        const origin = request.headers.origin;
        if (request.headers['sec-fetch-site'] === 'cross-site' || (origin && ![`http://${request.headers.host}`, `https://${request.headers.host}`].includes(origin))) {
          return json(response, 403, { error: '请在竞技场页面提交。' });
        }
      }
      if (method === 'POST' && pathname === '/api/login') {
        const data = await bodyFor(request);
        const login = arena.login(data?.username);
        if (!login) return json(response, 400, { error: '请输入 1–24 个字符的用户名，可用文字、数字、空格、下划线和连字符。' });
        arena.logout(token);
        response.setHeader('Set-Cookie', cookie(login.token, secureCookies));
        return json(response, 200, { account: login.account });
      }
      if (method === 'POST' && pathname === '/api/logout') {
        arena.logout(token);
        response.setHeader('Set-Cookie', cookie(null, secureCookies));
        return json(response, 200, {});
      }
      let data;
      if (method === 'GET' && pathname === '/api/state') data = arena.state(token);
      else if (method === 'POST' && pathname === '/api/bets') data = arena.bet(token, await bodyFor(request));
      else if (method === 'GET' && pathname === '/api/history') {
        const before = numberParam(searchParams.get('before'), Number.MAX_SAFE_INTEGER);
        if (!before) return json(response, 400, { error: '历史页码无效。' });
        data = arena.history(token, before);
      } else if (method === 'GET' && pathname === '/api/archive') {
        const number = numberParam(searchParams.get('round'));
        if (!number) return json(response, 400, { error: '轮次无效。' });
        data = arena.archive(token, number);
        if (data && !data.archive) return json(response, 404, { error: '查不到这局存档。' });
      } else {
        if (['GET', 'HEAD'].includes(method) && staticFile(request, response, pathname)) return;
        return json(response, 404, { error: '入口不可用。' });
      }
      return data ? json(response, 200, data) : json(response, 401, { error: '请先输入试玩用户名。' });
    } catch (error) {
      console.error('Arena request failed:', error.message);
      if (!response.headersSent) json(response, 500, { error: '服务暂时不可用，请重试。' });
      else response.end();
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const host = process.env.ARENA_HOST || '127.0.0.1';
  const port = Number(process.env.ARENA_PORT || 8780);
  const file = resolve(process.env.ARENA_DB || 'data/shared-arena.sqlite');
  const durations = durationsFromSeconds(Number(process.env.ARENA_BET_SECONDS ?? 60), Number(process.env.ARENA_BATTLE_SECONDS ?? 40));
  if (!durations || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('ARENA_PORT and round durations must be valid.');
  mkdirSync(dirname(file), { recursive: true });
  const arena = openArena(file, { durations });
  const server = createArenaServer({ arena, secureCookies: process.env.ARENA_SECURE_COOKIE === '1' });
  server.listen(port, host, () => console.log(`Shared arena listening on ${host}:${port}`));
  const timer = setInterval(() => {
    try { arena.tick(); }
    catch (error) { console.error('Arena tick failed:', error.message); }
  }, 500);
  function stop() {
    clearInterval(timer);
    server.close(() => arena.close());
  }
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
