'use strict';

const express = require('express');
const dotenv = require('dotenv');
const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');

dotenv.config();

const execFileAsync = promisify(execFile);
const app = express();

const PORT = Number(process.env.PORT || 9000);
const HOST = process.env.HOST || '0.0.0.0';
const HTTP_ERRORS = String(process.env.HTTP_ERRORS || 'false').toLowerCase() === 'true';
const VERBOSE = String(process.env.VERBOSE || 'false').toLowerCase() === 'true';
const DEFAULT_LIMIT_CONNECTIONS = String(process.env.DEFAULT_LIMIT_CONNECTIONS || '1');
const CONNECTION_COUNT_MODE = String(process.env.CONNECTION_COUNT_MODE || 'auto').toLowerCase();
const LIMITS_FILE = process.env.LIMITS_FILE || '/etc/checkuser/limits.json';
const ONLINE_FILE = process.env.ONLINE_FILE || '/etc/checkuser/online.json';
const API_KEY = process.env.CHECKUSER_API_KEY || '';

app.disable('x-powered-by');
app.use(express.json({ limit: '128kb' }));
app.use(express.urlencoded({ extended: false, limit: '128kb' }));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Hox-Key');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

function log(...args) {
  if (VERBOSE) console.log('[checkuser]', ...args);
}

function isSafeUsername(username) {
  return typeof username === 'string' && /^[a-zA-Z0-9._-]{1,64}$/.test(username);
}

function extractUsername(req) {
  const raw =
    req.params.username ||
    req.query.username ||
    req.query.login ||
    req.query.user ||
    req.body?.username ||
    req.body?.login ||
    req.body?.user ||
    '';

  let value = String(raw || '').trim();

  // Compatibility with old URL shape: /checkuser?user=/check/myuser?x=y
  try {
    value = decodeURIComponent(value);
  } catch (_) {}

  value = value.split('?')[0].trim();
  value = value.replace(/^https?:\/\/[^/]+/i, '');
  value = value.replace(/^\/checkuser\/?/i, '');
  value = value.replace(/^\/api\/checkuser\/?/i, '');
  value = value.replace(/^\/check\/?/i, '');
  value = value.replace(/^\/+/, '').trim();

  // If somebody sends user=abc/anything, keep first component only.
  if (value.includes('/')) value = value.split('/')[0];

  return value;
}

function apiKeyAllowed(req) {
  if (!API_KEY) return true;
  const provided = req.query.key || req.headers['x-hox-key'] || req.headers.authorization?.replace(/^Bearer\s+/i, '');
  return provided === API_KEY;
}

async function userExists(username) {
  try {
    await execFileAsync('getent', ['passwd', username], { timeout: 3000 });
    return true;
  } catch (_) {
    return false;
  }
}

function parseChageDate(output) {
  const line = String(output || '')
    .split(/\r?\n/)
    .find((l) => /^Account expires\s*:/i.test(l));

  if (!line) return null;
  const value = line.split(':').slice(1).join(':').trim();
  if (!value) return null;
  if (/never/i.test(value)) return 'never';
  return value;
}

async function getAccountExpiration(username) {
  const env = { ...process.env, LC_ALL: 'C', LANG: 'C' };
  const { stdout } = await execFileAsync('chage', ['-l', username], { timeout: 5000, env });
  return parseChageDate(stdout);
}

function parseExpirationDate(raw) {
  if (!raw) return null;
  if (raw === 'never') return 'never';

  // chage with LC_ALL=C normally returns e.g. "May 30, 2026".
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) return d;

  // Also accept dd/mm/yyyy or yyyy-mm-dd if user systems/scripts customize output.
  const ddmmyyyy = String(raw).match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (ddmmyyyy) {
    const [, dd, mm, yyyy] = ddmmyyyy;
    return new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  }

  const iso = String(raw).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const [, yyyy, mm, dd] = iso;
    return new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  }

  return null;
}

function formatDateBR(dateOrNever) {
  if (dateOrNever === 'never') return 'Indeterminado';
  if (!(dateOrNever instanceof Date) || Number.isNaN(dateOrNever.getTime())) return '';
  const dd = String(dateOrNever.getDate()).padStart(2, '0');
  const mm = String(dateOrNever.getMonth() + 1).padStart(2, '0');
  const yyyy = dateOrNever.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function diffDays(dateOrNever) {
  if (dateOrNever === 'never') return 9999;
  if (!(dateOrNever instanceof Date) || Number.isNaN(dateOrNever.getTime())) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateOrNever);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target - today) / 86400000);
}

function readJsonFile(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function readLimit(username) {
  const data = readJsonFile(LIMITS_FILE, {});
  const value = data?.[username];
  if (value === undefined || value === null || value === '') return DEFAULT_LIMIT_CONNECTIONS;
  return String(value);
}

async function countFromWho(username) {
  try {
    const { stdout } = await execFileAsync('who', [], { timeout: 3000 });
    return String(stdout || '')
      .split(/\r?\n/)
      .filter((line) => line.trim().split(/\s+/)[0] === username).length;
  } catch (_) {
    return 0;
  }
}

async function countFromProcess(username) {
  try {
    const { stdout } = await execFileAsync('pgrep', ['-u', username], { timeout: 3000 });
    return String(stdout || '').split(/\r?\n/).filter(Boolean).length;
  } catch (_) {
    return 0;
  }
}

function countFromOnlineFile(username) {
  const data = readJsonFile(ONLINE_FILE, null);
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const value = data[username];
    return Number(value || 0) || 0;
  }
  try {
    if (!fs.existsSync(ONLINE_FILE)) return 0;
    return fs.readFileSync(ONLINE_FILE, 'utf8')
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter((x) => x === username).length;
  } catch (_) {
    return 0;
  }
}

async function countConnections(username) {
  if (CONNECTION_COUNT_MODE === 'none') return 0;
  if (CONNECTION_COUNT_MODE === 'file') return countFromOnlineFile(username);
  if (CONNECTION_COUNT_MODE === 'who') return countFromWho(username);
  if (CONNECTION_COUNT_MODE === 'process') return countFromProcess(username);

  const fileCount = countFromOnlineFile(username);
  if (fileCount > 0) return fileCount;

  const whoCount = await countFromWho(username);
  if (whoCount > 0) return whoCount;

  return countFromProcess(username);
}

function hoxResponse({ username, exists, expirationDate, days, count, limit, status, message }) {
  const valid = Boolean(exists && days >= 0);
  const expired = Boolean(exists && days < 0);

  return {
    // Fields used by HoxTunnel HTML/app validity callbacks.
    username,
    expiration_date: expirationDate || '',
    expiration_days: exists ? days : 0,
    deviceId: '',
    count_connections: String(count ?? 0),
    limit_connections: String(limit ?? DEFAULT_LIMIT_CONNECTIONS),

    // Extra compatibility fields for other themes/scripts.
    exists: Boolean(exists),
    valid,
    expired,
    status: status || (valid ? 'active' : expired ? 'expired' : 'not_found'),
    message: message || (valid ? 'Usuário ativo' : expired ? 'Usuário expirado' : 'Usuário não encontrado'),
    success: Boolean(exists),
    ok: Boolean(exists),
  };
}

async function checkUser(username) {
  if (!isSafeUsername(username)) {
    return hoxResponse({ username: '', exists: false, status: 'bad_request', message: 'Usuário inválido' });
  }

  const exists = await userExists(username);
  if (!exists) {
    return hoxResponse({ username, exists: false, status: 'not_found', message: 'Usuário não encontrado' });
  }

  let rawExpiration = null;
  try {
    rawExpiration = await getAccountExpiration(username);
  } catch (err) {
    log('chage failed:', err.message);
    return hoxResponse({ username, exists: false, status: 'check_failed', message: 'Falha ao consultar validade' });
  }

  const parsed = parseExpirationDate(rawExpiration);
  const days = diffDays(parsed);
  const expirationDate = formatDateBR(parsed);
  const count = await countConnections(username);
  const limit = readLimit(username);

  return hoxResponse({
    username,
    exists: true,
    expirationDate,
    days,
    count,
    limit,
    status: days >= 0 ? 'active' : 'expired',
    message: days >= 0 ? 'Usuário ativo' : 'Usuário expirado',
  });
}

async function handleCheck(req, res) {
  if (!apiKeyAllowed(req)) {
    return res.status(401).json({ ok: false, success: false, status: 'unauthorized', error: 'Unauthorized' });
  }

  const username = extractUsername(req);
  log(`${req.method} ${req.originalUrl} ->`, username);

  const result = await checkUser(username);

  if (HTTP_ERRORS) {
    if (result.status === 'bad_request') return res.status(400).json(result);
    if (result.status === 'not_found') return res.status(404).json(result);
    if (result.status === 'check_failed') return res.status(500).json(result);
  }

  return res.status(200).json(result);
}

app.get('/', (req, res) => {
  res.type('text/plain').send([
    'HoxTunnel CheckUser API OK',
    '',
    'Compatible endpoints:',
    'GET  /check/USERNAME',
    'GET  /checkuser?user=USERNAME',
    'GET  /checkuser?user=/check/USERNAME',
    'POST /checkuser {"username":"USERNAME"}',
    '',
    'Health: /health',
  ].join('\n'));
});

app.get('/health', (req, res) => res.json({ ok: true, service: 'hox-checkuser-vps', time: new Date().toISOString() }));
app.get('/check/:username', handleCheck);
app.get('/checkuser', handleCheck);
app.get('/api/checkuser', handleCheck);
app.post('/checkuser', handleCheck);
app.post('/api/checkuser', handleCheck);

app.use((req, res) => {
  res.status(404).json({ ok: false, success: false, status: 'not_found', error: 'Route not found' });
});

app.listen(PORT, HOST, () => {
  console.log(`✅ HoxTunnel CheckUser API listening on http://${HOST}:${PORT}`);
  console.log(`Mode: local | HTTP_ERRORS=${HTTP_ERRORS} | CONNECTION_COUNT_MODE=${CONNECTION_COUNT_MODE}`);
});
