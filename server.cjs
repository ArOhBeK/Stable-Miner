const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 4310;
const DEFAULT_NODE_ENDPOINT =
  process.env.ERGO_NODE_URL || 'http://127.0.0.1:9053';
const EXPLORER_MAINNET =
  process.env.EXPLORER_MAINNET || 'https://api.ergoplatform.com/api/v1';
const EXPLORER_TESTNET =
  process.env.EXPLORER_TESTNET || 'https://api-testnet.ergoplatform.com/api/v1';
const DEXY_MIN_BOX_VALUE = 1000000n;
const DEXY_DEFAULT_FEE = 1000000n;
const DEXY_DECIMALS = 3;
const DEXY_CONSTANTS = {
  feeDenom: 1000n,
  bankFeeNum: 3n,
  buybackFeeNum: 2n,
  freeMintThresholdPercent: 98n,
  arbThresholdPercent: 101n,
  freeMintPeriod: 360,
  arbPeriod: 30,
  buffer: 5,
};
const DEXY_CONFIG = {
  mainnet: {
    useTokenId: 'a55b8735ed1a99e46c2c89f8994aacdf4b1109bdcf682f1e5b34479c6e392669',
    bankNft: '78c24bdf41283f45208664cd8eb78e2ffa7fbb29f26ebb43e6b31a46b3b975ae',
    freeMintNft: '40db16e1ed50b16077b19102390f36b41ca35c64af87426d04af3b9340859051',
    arbitrageMintNft: 'c79bef6fe21c788546beab08c963999d5ef74151a9b7fd6c1843f626eea0ecf5',
    buybackNft: 'dcce07af04ea4f9b7979336476594dc16321547bcc9c6b95a67cb1a94192da4f',
    oraclePoolNft: '6a2b821b5727e85beb5e78b4efb9f0250d59cd48481d2ded2c23e91ba1d07c66',
    lpNft: '4ecaa1aac9846b1454563ae51746db95a3a40ee9f8c5f5301afbe348ae803d41',
    lpTokenId: '804a66426283b8281240df8f9de783651986f20ad6391a71b26b9e7d6faad099',
    tracking101Nft: 'fec586b8d7b92b336a5fea060556cbb4ced15d5334dcb7ca9f9a7bb6ca866c42',
  },
  testnet: {
    useTokenId: '68e52efc3a235006e893afcf642a75d4e1e56f8c324b200a4c16d93216d83832',
    bankNft: '764eeeb81d8f6c566d7abae113ffe558ab86a4c10277800e958a017c86345c78',
    freeMintNft: '9a46aaf31a0c7410d86481240804932417238788dbc5f8478de6d07182cd3be6',
    arbitrageMintNft: 'e6a6a03862f94c77d7535dd5492f0934fbc9d89f1689bb4be2d215f0db3342a0',
    buybackNft: '9b8a5d2d1fff88653a11ce1d697e8e2e603dbfe34cc7124f4c76e5cd45c5bf34',
    oraclePoolNft: 'd94bfac40b516353983443209104dcdd5b7ca232a01ccb376ee8014df6330907',
    lpNft: '6873424faf94dad45f54d20793dc6214026ab68bd3309b46b5695243174efafa',
    lpTokenId: '53f62621df1ada5e27f38032610314125395fdddea39064971f51633468a0af0',
    tracking101Nft: 'f14b42ab7a8ff1ba2e2b7056e27cd9c7e018c355499c385850db7f34da881431',
  },
};

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
};

const sessions = new Map();
const tasks = new Map();

let minerProcess = null;
let minerConfig = null;
let minerStats = null;
let minerStatsAt = 0;

const MAX_TASK_LOG = 200000;
const VENDOR_DIR = path.join(ROOT, 'vendor');
const RIGEL_DIR = path.join(VENDOR_DIR, 'rigel');

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJsonBody(req) {
  const raw = await readRequestBody(req);
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    return {};
  }
}

function generateSessionId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString('hex');
}

function normalizePathname(pathname) {
  const decoded = decodeURIComponent(pathname);
  return decoded.replace(/\/+$/, '') || '/';
}

function safeJoin(root, target) {
  const targetPath = path.normalize(path.join(root, target));
  if (!targetPath.startsWith(root)) {
    return null;
  }
  return targetPath;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function createTask(type) {
  const task = {
    id: generateSessionId(),
    type,
    status: 'running',
    log: '',
    startedAt: Date.now(),
    finishedAt: null,
    result: null,
    error: null,
  };
  tasks.set(task.id, task);
  return task;
}

function appendTaskLog(task, chunk) {
  const text = chunk.toString();
  task.log += text;
  if (task.log.length > MAX_TASK_LOG) {
    task.log = task.log.slice(-MAX_TASK_LOG);
  }
}

function resolveCommand(command) {
  if (process.platform === 'win32' && ['npm', 'npx'].includes(command)) {
    return `${command}.cmd`;
  }
  return command;
}

function escapeCmdArg(arg) {
  if (arg === '') {
    return '""';
  }
  if (/[\s"]/u.test(arg)) {
    return `"${arg.replace(/"/g, '\\"')}"`;
  }
  return arg;
}

function runCommand(task, command, args, options = {}) {
  const cmd = resolveCommand(command);
  appendTaskLog(task, `\n> ${cmd} ${args.join(' ')}\n`);
  return new Promise((resolve, reject) => {
    const cwd = options.cwd || ROOT;
    const env = { ...process.env, ...(options.env || {}) };
    const child =
      process.platform === 'win32'
        ? spawn(
            'cmd.exe',
            ['/d', '/s', '/c', [cmd, ...args].map(escapeCmdArg).join(' ')],
            { cwd, env, windowsHide: true },
          )
        : spawn(cmd, args, { cwd, env });
    child.stdout.on('data', (data) => appendTaskLog(task, data));
    child.stderr.on('data', (data) => appendTaskLog(task, data));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${cmd} exited with code ${code}`));
      }
    });
  });
}

function runCommandCapture(command, args, options = {}) {
  const cmd = resolveCommand(command);
  return new Promise((resolve, reject) => {
    const cwd = options.cwd || ROOT;
    const env = { ...process.env, ...(options.env || {}) };
    const useCmd = process.platform === 'win32' && !options.direct;
    const child = useCmd
      ? spawn(
          'cmd.exe',
          ['/d', '/s', '/c', [cmd, ...args].map(escapeCmdArg).join(' ')],
          { cwd, env, windowsHide: true },
        )
      : spawn(cmd, args, { cwd, env, windowsHide: true });
    let stdout = '';
    let stderr = '';
    if (child.stdout) {
      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });
    }
    if (child.stderr) {
      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });
    }
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`${cmd} exited with code ${code}`));
      }
    });
  });
}

function finalizeTask(task, error) {
  task.finishedAt = Date.now();
  if (error) {
    task.status = 'failed';
    task.error = error.message;
    appendTaskLog(task, `\nError: ${error.message}\n`);
  } else {
    task.status = 'completed';
  }
}

function parseApiBind(value) {
  if (!value) {
    return '127.0.0.1:5000';
  }
  return value.includes(':') ? value : `${value}:5000`;
}

function parseNanoErg(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new Error('ERG amount is required.');
  }
  const cleaned = input.trim().replace(/_/g, '');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) {
    throw new Error('ERG amount must be a number.');
  }
  const [whole, fraction = ''] = cleaned.split('.');
  if (fraction.length > 9) {
    throw new Error('ERG amount supports up to 9 decimal places.');
  }
  const nanoFraction = (fraction + '000000000').slice(0, 9);
  return BigInt(whole) * 1000000000n + BigInt(nanoFraction);
}

function formatNanoErg(nanoErg) {
  const negative = nanoErg < 0n;
  const value = negative ? -nanoErg : nanoErg;
  const whole = value / 1000000000n;
  const fraction = (value % 1000000000n).toString().padStart(9, '0');
  const trimmed = fraction.replace(/0+$/, '');
  const body = trimmed ? `${whole}.${trimmed}` : `${whole}`;
  return negative ? `-${body}` : body;
}

function formatTokenAmount(amount, decimals) {
  const value = BigInt(amount);
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(decimals, '0');
  const trimmed = fraction.replace(/0+$/, '');
  return trimmed ? `${whole}.${trimmed}` : `${whole}`;
}

function toSafeNumber(value, label) {
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  if (value > max) {
    throw new Error(`${label} exceeds JS safe integer range.`);
  }
  return Number(value);
}

function toJsonAmount(value, label) {
  const bigValue = BigInt(value);
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  if (bigValue > max) {
    return bigValue.toString();
  }
  return Number(bigValue);
}

function encodeLeb128(value) {
  let remaining = value;
  const bytes = [];
  while (remaining >= 0x80n) {
    bytes.push(Number((remaining & 0x7fn) | 0x80n));
    remaining >>= 7n;
  }
  bytes.push(Number(remaining));
  return Buffer.from(bytes);
}

function decodeLeb128(bytes) {
  let result = 0n;
  let shift = 0n;
  for (const byte of bytes) {
    const chunk = BigInt(byte & 0x7f);
    result |= chunk << shift;
    if ((byte & 0x80) === 0) {
      break;
    }
    shift += 7n;
  }
  return result;
}

function encodeZigZag(value) {
  if (value >= 0n) {
    return value * 2n;
  }
  return (-value * 2n) - 1n;
}

function decodeZigZag(value) {
  if (value & 1n) {
    return -((value + 1n) / 2n);
  }
  return value / 2n;
}

function encodeSValue(prefix, value) {
  const zigzag = encodeZigZag(value);
  const body = encodeLeb128(zigzag);
  return Buffer.concat([Buffer.from([prefix]), body]).toString('hex');
}

function decodeSValue(hex) {
  if (typeof hex !== 'string' || !hex) {
    throw new Error('Missing SValue register.');
  }
  const bytes = Buffer.from(hex, 'hex');
  if (!bytes.length) {
    throw new Error('Empty SValue register.');
  }
  const prefix = bytes[0];
  const zigzag = decodeLeb128(bytes.subarray(1));
  return { prefix, value: decodeZigZag(zigzag) };
}

function decodeSValueInt(hex) {
  const { prefix, value } = decodeSValue(hex);
  if (prefix !== 0x04) {
    throw new Error('Expected Int SValue.');
  }
  return Number(value);
}

function decodeSValueLong(hex) {
  const { prefix, value } = decodeSValue(hex);
  if (prefix !== 0x05) {
    throw new Error('Expected Long SValue.');
  }
  return value;
}

function encodeSValueInt(value) {
  return encodeSValue(0x04, BigInt(value));
}

function encodeSValueLong(value) {
  return encodeSValue(0x05, BigInt(value));
}

function encodeSValueCollByte(hex) {
  if (typeof hex !== 'string' || !/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error('Invalid box id for register encoding.');
  }
  return `0e20${hex.toLowerCase()}`;
}

function serializeNodePayload(payload) {
  const json = JSON.stringify(payload, (key, value) => {
    if (
      (key === 'amount' || key === 'value' || key === 'fee') &&
      typeof value === 'string' &&
      /^\d+$/.test(value)
    ) {
      return `__bigint__${value}`;
    }
    if (typeof value === 'bigint') {
      return `__bigint__${value.toString()}`;
    }
    return value;
  });
  return json.replace(/"__bigint__(\d+)"/g, '$1');
}

function normalizeNodeEndpoint(endpoint) {
  if (!endpoint || typeof endpoint !== 'string') {
    return '';
  }
  let normalized = endpoint.trim();
  if (!normalized) {
    return '';
  }
  if (!/^https?:\/\//i.test(normalized)) {
    normalized = `http://${normalized}`;
  }
  return normalized.replace(/\/+$/, '');
}

function parseNetworkFromInfo(info, fallback) {
  const raw =
    (info && (info.network || info.networkType || info.networkName)) || fallback;
  if (typeof raw === 'string') {
    const lowered = raw.toLowerCase();
    if (lowered.includes('test')) {
      return 'testnet';
    }
    if (lowered.includes('main')) {
      return 'mainnet';
    }
  }
  return fallback === 'testnet' ? 'testnet' : 'mainnet';
}

function buildNodeHeaders(apiKey) {
  const headers = {};
  if (apiKey) {
    headers.api_key = apiKey;
  }
  return headers;
}

async function fetchNodeInfo(endpoint, timeoutMs) {
  const url = `${endpoint}/info`;
  return httpRequestJson(url, { timeoutMs });
}

async function fetchWalletAddresses(endpoint, apiKey) {
  const url = `${endpoint}/wallet/addresses`;
  const data = await httpRequestJson(url, {
    headers: buildNodeHeaders(apiKey),
  });
  if (Array.isArray(data)) {
    return data;
  }
  if (data && Array.isArray(data.addresses)) {
    return data.addresses;
  }
  return [];
}

function getDexyConfig(network) {
  return DEXY_CONFIG[network] || DEXY_CONFIG.mainnet;
}

async function nodeGetJson(endpoint, path, apiKey) {
  const url = `${endpoint}${path}`;
  try {
    return await httpRequestJson(url, { headers: buildNodeHeaders(apiKey) });
  } catch (error) {
    const message = error && error.message ? error.message : '';
    if (message.includes('Malformed request: None.get')) {
      throw new Error(`Node GET ${path} failed: ${message}`);
    }
    throw error;
  }
}

async function nodePostJson(endpoint, path, apiKey, payload) {
  const url = `${endpoint}${path}`;
  const body = serializeNodePayload(payload);
  try {
    return await httpRequestJson(url, {
      method: 'POST',
      headers: {
        ...buildNodeHeaders(apiKey),
        'Content-Type': 'application/json',
      },
      body,
    });
  } catch (error) {
    const message = error && error.message ? error.message : '';
    if (message.includes('Malformed request: None.get')) {
      throw new Error(`Node POST ${path} failed: ${message}`);
    }
    throw error;
  }
}

function unpackWithPool(data) {
  if (!data) {
    return { box: null, spentTransactionId: null };
  }
  if (data.box) {
    return {
      box: data.box,
      spentTransactionId: data.spentTransactionId || data.box.spentTransactionId || null,
    };
  }
  return { box: data, spentTransactionId: data.spentTransactionId || null };
}

async function fetchBoxWithPool(endpoint, boxId, apiKey) {
  const data = await nodeGetJson(endpoint, `/utxo/withPool/byId/${boxId}`, apiKey);
  return unpackWithPool(data);
}

async function fetchBoxById(endpoint, boxId, apiKey) {
  try {
    return await nodeGetJson(endpoint, `/blockchain/box/byId/${boxId}`, apiKey);
  } catch (error) {
    // Fall back to mempool-aware endpoint if needed.
  }
  const fallback = await nodeGetJson(
    endpoint,
    `/utxo/withPool/byId/${boxId}`,
    apiKey,
  );
  return fallback && fallback.box ? fallback.box : fallback;
}

async function fetchTokenInfo(endpoint, tokenId, apiKey) {
  return nodeGetJson(endpoint, `/blockchain/token/byId/${tokenId}`, apiKey);
}

async function fetchUnspentBoxByTokenId(endpoint, tokenId, apiKey) {
  const path =
    `/blockchain/box/unspent/byTokenId/${tokenId}?offset=0&limit=1&sortDirection=desc`;
  const boxes = await nodeGetJson(endpoint, path, apiKey);
  if (!Array.isArray(boxes) || boxes.length === 0) {
    throw new Error(`No unspent box found for token ${tokenId}.`);
  }
  for (const candidate of boxes) {
    if (!candidate || !candidate.boxId) {
      continue;
    }
    let withPool = null;
    try {
      withPool = await fetchBoxWithPool(endpoint, candidate.boxId, apiKey);
    } catch (error) {
      withPool = null;
    }
    if (withPool && withPool.spentTransactionId) {
      continue;
    }
    if (withPool && withPool.box) {
      return withPool.box;
    }
    try {
      return await fetchBoxById(endpoint, candidate.boxId, apiKey);
    } catch (error) {
      return candidate;
    }
  }
  throw new Error(`All candidate boxes for token ${tokenId} are spent in mempool.`);
}

async function fetchBoxBytes(endpoint, boxId) {
  const url = `${endpoint}/utxo/byIdBinary/${boxId}`;
  try {
    const data = await httpRequestJson(url);
    if (data && data.bytes) {
      return data.bytes;
    }
  } catch (error) {
    // Fallback to mempool-aware endpoint below.
  }
  const fallbackUrl = `${endpoint}/utxo/withPool/byIdBinary/${boxId}`;
  const fallback = await httpRequestJson(fallbackUrl);
  if (!fallback || !fallback.bytes) {
    throw new Error(`Unable to fetch bytes for box ${boxId}.`);
  }
  return fallback.bytes;
}

async function fetchWalletBoxes(endpoint, apiKey) {
  const path =
    '/wallet/boxes/unspent?minConfirmations=0&maxConfirmations=-1&minInclusionHeight=0&maxInclusionHeight=-1';
  const data = await nodeGetJson(endpoint, path, apiKey);
  if (Array.isArray(data)) {
    return data;
  }
  if (data && Array.isArray(data.boxes)) {
    return data.boxes;
  }
  return [];
}

async function ensureBoxAddress(endpoint, apiKey, box) {
  if (box.address) {
    return box.address;
  }
  if (!box.ergoTree) {
    throw new Error('Box is missing ergoTree.');
  }
  const tree = box.ergoTree;
  const payloads = [tree, { tree }, { ergoTree: tree }];
  let lastError = null;
  for (const payload of payloads) {
    try {
      const address = await nodePostJson(
        endpoint,
        '/utils/ergoTreeToAddress',
        apiKey,
        payload,
      );
      if (typeof address === 'string') {
        return address;
      }
      if (address && address.address) {
        return address.address;
      }
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) {
    throw lastError;
  }
  throw new Error('Unable to resolve box address.');
}

function unwrapBox(entry) {
  return entry && entry.box ? entry.box : entry;
}

function normalizeAssets(list) {
  if (!Array.isArray(list)) {
    return [];
  }
  return list
    .map((asset) => {
      if (!asset) {
        return null;
      }
      if (Array.isArray(asset) && asset.length >= 2) {
        return { tokenId: asset[0], amount: asset[1] };
      }
      const tokenId = asset.tokenId || asset.id || asset.assetId;
      const amount =
        asset.amount !== undefined ? asset.amount : asset.value ?? asset.quantity;
      if (!tokenId || amount === undefined) {
        return null;
      }
      return { tokenId, amount };
    })
    .filter(Boolean);
}

function getBoxAssets(box) {
  if (!box || typeof box !== 'object') {
    return [];
  }
  if (Array.isArray(box.assets)) {
    return normalizeAssets(box.assets);
  }
  if (Array.isArray(box.additionalTokens)) {
    return normalizeAssets(box.additionalTokens);
  }
  if (Array.isArray(box.tokens)) {
    return normalizeAssets(box.tokens);
  }
  return [];
}

function normalizeTokenId(tokenId) {
  if (typeof tokenId === 'string') {
    return tokenId.toLowerCase();
  }
  if (tokenId === undefined || tokenId === null) {
    return '';
  }
  return String(tokenId).toLowerCase();
}

function findAssetAmount(box, tokenId) {
  const target = normalizeTokenId(tokenId);
  const asset = getBoxAssets(box).find(
    (item) => normalizeTokenId(item.tokenId) === target,
  );
  return asset ? BigInt(asset.amount) : 0n;
}

async function scanLocalNode() {
  const candidates = [
    DEFAULT_NODE_ENDPOINT,
    'http://localhost:9053',
    'http://127.0.0.1:9052',
    'http://localhost:9052',
    'http://127.0.0.1:9051',
    'http://localhost:9051',
  ];
  for (const endpoint of candidates) {
    const normalized = normalizeNodeEndpoint(endpoint);
    if (!normalized) {
      continue;
    }
    try {
      const info = await fetchNodeInfo(normalized, 800);
      return { endpoint: normalized, info };
    } catch (error) {
      // Try the next candidate.
    }
  }
  return null;
}

function apiBindToUrl(bind) {
  const raw = bind.startsWith('http') ? bind : `http://${bind}`;
  const url = new URL(raw);
  if (url.hostname === '0.0.0.0') {
    url.hostname = '127.0.0.1';
  }
  const normalized = `${url.origin}${url.pathname}`;
  return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

function splitArgs(text) {
  if (!text) {
    return [];
  }
  const result = [];
  let current = '';
  let quote = null;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ' ') {
      if (current) {
        result.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current) {
    result.push(current);
  }
  return result;
}

function hasArg(args, names) {
  return args.some((arg) => names.includes(arg));
}

function buildRigelArgs(config) {
  const extraArgs = splitArgs(config.args || '');

  if (!hasArg(extraArgs, ['-a', '--algorithm', '--a1', '--a2', '--a3'])) {
    extraArgs.push('-a', 'autolykos2');
  }
  if (!hasArg(extraArgs, ['-o', '--url'])) {
    extraArgs.push('-o', config.pool);
  }
  if (!hasArg(extraArgs, ['-u', '--username'])) {
    extraArgs.push('-u', config.address);
  }
  if (config.worker && !hasArg(extraArgs, ['-w', '--worker'])) {
    extraArgs.push('-w', config.worker);
  }
  if (!hasArg(extraArgs, ['-p', '--password'])) {
    extraArgs.push('-p', 'x');
  }
  if (config.apiBind && !hasArg(extraArgs, ['--api-bind'])) {
    extraArgs.push('--api-bind', config.apiBind);
  }

  return extraArgs;
}

function httpRequestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const { body, timeoutMs, ...requestOptions } = options;
    const req = client.request(url, requestOptions, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const parsed = parseJsonLossless(body);
            resolve(parsed);
          } catch (error) {
            reject(new Error('Invalid JSON response.'));
          }
          return;
        }
        reject(new Error(`HTTP ${res.statusCode}: ${body}`));
      });
    });
    req.on('error', reject);
    if (timeoutMs) {
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error('Request timed out.'));
      });
    }
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

function findFileRecursive(dir, filename) {
  if (!fs.existsSync(dir)) {
    return null;
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === filename.toLowerCase()) {
      return fullPath;
    }
    if (entry.isDirectory()) {
      const found = findFileRecursive(fullPath, filename);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function downloadFile(url, dest, task) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const request = client.get(
      url,
      {
        headers: {
          'User-Agent': 'StableMiner',
          Accept: 'application/octet-stream',
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400) {
          const redirect = res.headers.location;
          res.resume();
          if (redirect) {
            downloadFile(redirect, dest, task).then(resolve).catch(reject);
            return;
          }
        }
        if (!res.statusCode || res.statusCode >= 400) {
          reject(new Error(`Download failed: ${res.statusCode}`));
          return;
        }
        ensureDir(path.dirname(dest));
        const file = fs.createWriteStream(dest);
        let downloaded = 0;
        res.on('data', (chunk) => {
          downloaded += chunk.length;
          if (task && downloaded % 5000000 < chunk.length) {
            appendTaskLog(task, `Downloaded ${(downloaded / 1024 / 1024).toFixed(1)} MB\n`);
          }
        });
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
        file.on('error', reject);
      },
    );
    request.on('error', reject);
  });
}

async function getLatestRigelRelease() {
  return httpRequestJson('https://api.github.com/repos/rigelminer/rigel/releases/latest', {
    headers: {
      'User-Agent': 'StableMiner',
      Accept: 'application/vnd.github+json',
    },
  });
}

async function runRigelInstall(task) {
  const platform = process.platform;
  if (platform !== 'win32' && platform !== 'linux') {
    throw new Error('Rigel installer is only wired for Windows and Linux in this UI.');
  }
  appendTaskLog(task, 'Fetching latest Rigel release...\n');
  const release = await getLatestRigelRelease();
  const assets = Array.isArray(release.assets) ? release.assets : [];
  let asset = null;
  if (platform === 'win32') {
    asset = assets.find(
      (item) => item.name.endsWith('-win.zip') || item.name.includes('win.zip'),
    );
    if (!asset) {
      throw new Error('No Rigel Windows asset found.');
    }
  } else {
    const linuxAssets = assets.filter((item) => {
      const name = item.name.toLowerCase();
      return (
        name.includes('linux') &&
        (name.endsWith('.tar.gz') ||
          name.endsWith('.tgz') ||
          name.endsWith('.tar.xz') ||
          name.endsWith('.zip'))
      );
    });
    asset =
      linuxAssets.find((item) => {
        const name = item.name.toLowerCase();
        if (name.includes('arm') || name.includes('aarch')) {
          return false;
        }
        return name.includes('x86_64') || name.includes('amd64') || name.includes('64');
      }) ||
      linuxAssets.find((item) => {
        const name = item.name.toLowerCase();
        return !name.includes('arm') && !name.includes('aarch');
      }) ||
      linuxAssets[0];
    if (!asset) {
      throw new Error('No Rigel Linux asset found.');
    }
  }

  ensureDir(RIGEL_DIR);
  const archivePath = path.join(RIGEL_DIR, asset.name);
  appendTaskLog(task, `Downloading ${asset.name}...\n`);
  await downloadFile(asset.browser_download_url, archivePath, task);

  appendTaskLog(task, 'Extracting Rigel archive...\n');
  if (platform === 'win32') {
    const psZip = archivePath.replace(/'/g, "''");
    const psDest = RIGEL_DIR.replace(/'/g, "''");
    const psCommand = `Expand-Archive -LiteralPath '${psZip}' -DestinationPath '${psDest}' -Force`;
    await runCommand(task, 'powershell', [
      '-NoProfile',
      '-Command',
      psCommand,
    ]);
  } else {
    const lower = asset.name.toLowerCase();
    if (lower.endsWith('.zip')) {
      try {
        await runCommand(task, 'unzip', ['-o', archivePath, '-d', RIGEL_DIR]);
      } catch (error) {
        appendTaskLog(task, 'unzip failed, attempting tar extraction...\n');
        await runCommand(task, 'tar', ['-xf', archivePath, '-C', RIGEL_DIR]);
      }
    } else if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
      await runCommand(task, 'tar', ['-xzf', archivePath, '-C', RIGEL_DIR]);
    } else if (lower.endsWith('.tar.xz')) {
      await runCommand(task, 'tar', ['-xJf', archivePath, '-C', RIGEL_DIR]);
    } else {
      throw new Error('Unsupported Rigel archive format for Linux.');
    }
  }

  const rigelName = platform === 'win32' ? 'rigel.exe' : 'rigel';
  const rigelPath = findFileRecursive(RIGEL_DIR, rigelName);
  if (rigelPath) {
    if (platform === 'linux') {
      await runCommand(task, 'chmod', ['+x', rigelPath]);
    }
    task.result = { rigelPath };
    appendTaskLog(task, `Rigel installed at ${rigelPath}\n`);
  } else {
    appendTaskLog(task, 'Rigel executable not found after extraction.\n');
  }
}

async function fetchErgoBalance(address, network) {
  const baseUrl = network === 'testnet' ? EXPLORER_TESTNET : EXPLORER_MAINNET;
  const url = `${baseUrl}/addresses/${address}/balance/confirmed`;
  try {
    const data = await httpRequestJson(url);
    const nanoErgs = Number(data.nanoErgs || 0);
    const erg = nanoErgs / 1e9;
    const tokens = Array.isArray(data.tokens) ? data.tokens.length : 0;
    return {
      balance: `${erg.toFixed(3)} ERG`,
      tokens: `${tokens}`,
      network: network === 'testnet' ? 'Testnet' : 'Mainnet',
    };
  } catch (error) {
    return {
      balance: '--',
      tokens: '--',
      network: network === 'testnet' ? 'Testnet' : 'Mainnet',
    };
  }
}

async function fetchMinerStats(apiUrl) {
  if (!apiUrl) {
    return null;
  }
  const base = new URL(apiUrl);
  const pathCandidates = base.pathname && base.pathname !== '/'
    ? [base.pathname]
    : ['/', '/stat', '/stats', '/api/v1/stats', '/summary'];

  for (const pathSuffix of pathCandidates) {
    const url = `${base.origin}${pathSuffix}`;
    try {
      const data = await httpRequestJson(url);
      return { data, source: url };
    } catch (error) {
      // Try next endpoint.
    }
  }
  return null;
}

function getPathValue(obj, pathKeys) {
  let current = obj;
  for (const key of pathKeys) {
    if (current && Object.prototype.hasOwnProperty.call(current, key)) {
      current = current[key];
    } else {
      return undefined;
    }
  }
  return current;
}

function findNumeric(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function parseRateUnit(unit) {
  if (!unit || typeof unit !== 'string') {
    return null;
  }
  const cleaned = unit.toLowerCase().replace(/[^a-z]/g, '');
  if (!cleaned) {
    return null;
  }
  if (cleaned.startsWith('th')) {
    return 1e12;
  }
  if (cleaned.startsWith('gh')) {
    return 1e9;
  }
  if (cleaned.startsWith('mh')) {
    return 1e6;
  }
  if (cleaned.startsWith('kh')) {
    return 1e3;
  }
  if (cleaned.startsWith('h')) {
    return 1;
  }
  return null;
}

function applyRateUnit(value, unit) {
  const multiplier = parseRateUnit(unit);
  if (multiplier === null) {
    return value;
  }
  return value * multiplier;
}

function parseHashrateValue(value, unitHint) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return applyRateUnit(value, unitHint);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const match = trimmed.match(/^([\d.]+)\s*([a-zA-Z/]+)?/);
    if (match) {
      const numeric = Number(match[1]);
      if (Number.isFinite(numeric)) {
        const unit = match[2] || unitHint;
        return applyRateUnit(numeric, unit);
      }
    }
    return trimmed;
  }
  if (typeof value === 'object') {
    const unit =
      value.unit ||
      value.units ||
      value.hashrate_unit ||
      value.hashrateUnit ||
      unitHint;
    const numeric =
      findNumeric(value.total) ??
      findNumeric(value.value) ??
      findNumeric(value.rate) ??
      findNumeric(value.hashrate);
    if (numeric !== undefined) {
      return applyRateUnit(numeric, unit);
    }
    if (typeof value.text === 'string') {
      return value.text;
    }
  }
  return null;
}

function isProcessAlive(pid) {
  if (!pid || typeof pid !== 'number') {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return false;
  }
}

function getHashrateUnitHint(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  return (
    raw.hashrate_unit ||
    raw.hashrateUnit ||
    raw.hashrateUnits ||
    raw.hashrate?.unit ||
    raw.hashrate?.units ||
    raw.miner?.hashrate_unit ||
    raw.miner?.hashrateUnit ||
    raw.summary?.hashrate_unit ||
    raw.summary?.hashrateUnit ||
    null
  );
}

function formatHashrate(value) {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '--';
  }
  const units = ['H/s', 'kH/s', 'MH/s', 'GH/s', 'TH/s'];
  let unitIndex = 0;
  let rate = value;
  while (rate >= 1000 && unitIndex < units.length - 1) {
    rate /= 1000;
    unitIndex += 1;
  }
  return `${rate.toFixed(2)} ${units[unitIndex]}`;
}

function formatPower(value) {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '--';
  }
  return `${value.toFixed(0)} W`;
}

function formatUptime(value) {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '--';
  }
  const seconds = Math.max(0, Math.floor(value));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

function normalizeMinerStats(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const unitHint = getHashrateUnitHint(raw);
  let hashrate =
    parseHashrateValue(raw.hashrate, unitHint) ||
    parseHashrateValue(getPathValue(raw, ['hashrate', 'total']), unitHint) ||
    parseHashrateValue(getPathValue(raw, ['hashrate', 'total_hashrate']), unitHint) ||
    parseHashrateValue(getPathValue(raw, ['miner', 'hashrate']), unitHint) ||
    parseHashrateValue(getPathValue(raw, ['summary', 'hashrate']), unitHint) ||
    parseHashrateValue(getPathValue(raw, ['total_hashrate']), unitHint);

  let power =
    findNumeric(raw.power) ||
    findNumeric(getPathValue(raw, ['power', 'total'])) ||
    findNumeric(getPathValue(raw, ['summary', 'power'])) ||
    findNumeric(getPathValue(raw, ['miner', 'power'])) ||
    findNumeric(getPathValue(raw, ['total_power']));

  const deviceArrays =
    raw.gpus || raw.devices || raw.cards || raw.hardware || raw.gpu;
  if (Array.isArray(deviceArrays)) {
    if (!hashrate || typeof hashrate !== 'number') {
      const rates = deviceArrays
        .map((item) =>
          parseHashrateValue(
            item.hashrate || item.hash_rate || item.speed,
            item.unit || item.hashrate_unit || item.hashrateUnit || unitHint,
          ),
        )
        .filter((value) => typeof value === 'number');
      if (rates.length) {
        hashrate = rates.reduce((acc, value) => acc + value, 0);
      }
    }
    if (!power) {
      power = deviceArrays
        .map((item) => findNumeric(item.power || item.power_draw))
        .filter((value) => value !== undefined)
        .reduce((acc, value) => acc + value, 0);
    }
  }

  const accepted =
    findNumeric(getPathValue(raw, ['shares', 'accepted'])) ||
    findNumeric(getPathValue(raw, ['shares', 'accept'])) ||
    findNumeric(getPathValue(raw, ['accepted_shares'])) ||
    findNumeric(getPathValue(raw, ['accepted'])) ||
    findNumeric(getPathValue(raw, ['sharesAccepted']));

  const uptime =
    findNumeric(raw.uptime) ||
    findNumeric(getPathValue(raw, ['miner', 'uptime'])) ||
    findNumeric(getPathValue(raw, ['summary', 'uptime'])) ||
    findNumeric(getPathValue(raw, ['uptime_seconds'])) ||
    findNumeric(getPathValue(raw, ['uptimeSec']));

  return {
    hashrate: formatHashrate(hashrate),
    power: formatPower(power),
    shares: accepted !== undefined ? `${accepted}` : '--',
    uptime: formatUptime(uptime),
  };
}

function cloneAssets(assets) {
  return getBoxAssets({ assets }).map((asset) => ({
    tokenId: asset.tokenId,
    amount: asset.amount,
  }));
}

function updateAssetAmount(assets, tokenId, amount) {
  let found = false;
  const updated = assets.map((asset) => {
    if (asset.tokenId === tokenId) {
      found = true;
      return { ...asset, amount: toJsonAmount(amount, 'Token amount') };
    }
    return { ...asset };
  });
  if (!found) {
    throw new Error(`Token ${tokenId} not found in box assets.`);
  }
  return updated;
}

function collectTokenMap(boxes) {
  const tokens = new Map();
  boxes.forEach((entry) => {
    const box = unwrapBox(entry);
    getBoxAssets(box).forEach((asset) => {
      const current = tokens.get(asset.tokenId) || 0n;
      tokens.set(asset.tokenId, current + BigInt(asset.amount));
    });
  });
  return tokens;
}

function tokenMapToAssets(tokenMap) {
  return Array.from(tokenMap.entries()).map(([tokenId, amount]) => ({
    tokenId,
    amount: toJsonAmount(amount, 'Change token amount'),
  }));
}

function sumWalletNano(walletBoxes) {
  return (walletBoxes || []).reduce((total, entry) => {
    const box = unwrapBox(entry);
    if (!box || box.value === undefined || box.value === null) {
      return total;
    }
    return total + BigInt(box.value);
  }, 0n);
}

function parseNotEnoughErgs(message) {
  if (typeof message !== 'string') {
    return null;
  }
  const match = message.match(
    /NotEnoughErgsError\\(not enough boxes to meet ERG needs (\\d+) \\(found only (\\d+)\\)[^)]*\\)/,
  );
  if (!match) {
    return null;
  }
  return { needed: BigInt(match[1]), found: BigInt(match[2]) };
}

function parseNotEnoughTokens(message, tokenId) {
  if (typeof message !== 'string' || !message.includes('NotEnoughTokensError')) {
    return null;
  }
  if (!tokenId) {
    return { message: 'Not enough tokens to fund the mint outputs.' };
  }
  const normalized = normalizeTokenId(tokenId);
  const regex = new RegExp(`${normalized} -> (\\d+)`, 'gi');
  const matches = [];
  let match = regex.exec(message);
  while (match) {
    matches.push(BigInt(match[1]));
    match = regex.exec(message);
  }
  if (matches.length >= 2) {
    return { needed: matches[0], found: matches[1] };
  }
  return { message: 'Not enough tokens to fund the mint outputs.' };
}

function isNoneGetError(message) {
  return typeof message === 'string' && message.includes('Malformed request: None.get');
}

function assertAddress(label, address) {
  if (typeof address !== 'string' || !address.trim()) {
    throw new Error(`${label} address is missing or invalid.`);
  }
}

function assertHexBytes(label, bytes) {
  if (typeof bytes !== 'string' || !/^[0-9a-f]+$/i.test(bytes)) {
    throw new Error(`${label} bytes are missing or invalid.`);
  }
}

async function assertBoxesUnspent(endpoint, apiKey, boxIds) {
  const spent = [];
  for (const boxId of boxIds) {
    if (!boxId) {
      continue;
    }
    try {
      const withPool = await fetchBoxWithPool(endpoint, boxId, apiKey);
      if (withPool && withPool.spentTransactionId) {
        spent.push(boxId);
      }
    } catch (error) {
      // If mempool status cannot be checked, skip.
    }
  }
  if (spent.length) {
    throw new Error(
      `Input boxes already spent in mempool: ${spent.join(', ')}. Refresh and retry.`,
    );
  }
}

function parseJsonLossless(text) {
  if (typeof text !== 'string') {
    return null;
  }
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === '-' || (ch >= '0' && ch <= '9')) {
      let start = i;
      let hasFraction = false;
      let hasExponent = false;
      if (ch === '-') {
        i += 1;
      }
      while (i < text.length && text[i] >= '0' && text[i] <= '9') {
        i += 1;
      }
      if (text[i] === '.') {
        hasFraction = true;
        i += 1;
        while (i < text.length && text[i] >= '0' && text[i] <= '9') {
          i += 1;
        }
      }
      if (text[i] === 'e' || text[i] === 'E') {
        hasExponent = true;
        i += 1;
        if (text[i] === '+' || text[i] === '-') {
          i += 1;
        }
        while (i < text.length && text[i] >= '0' && text[i] <= '9') {
          i += 1;
        }
      }
      const token = text.slice(start, i);
      const digits = token.startsWith('-') ? token.slice(1) : token;
      if (!hasFraction && !hasExponent && digits.length > 15) {
        out += `"${token}"`;
      } else {
        out += token;
      }
      i -= 1;
      continue;
    }
    out += ch;
  }
  return JSON.parse(out);
}

function selectWalletInputs(walletBoxes, requiredNano, minChangeNano) {
  const cleanBoxes = walletBoxes
    .map((entry) => ({ box: unwrapBox(entry), address: entry.address }))
    .filter((entry) => entry.box && entry.box.boxId);
  const noToken = cleanBoxes.filter((entry) => getBoxAssets(entry.box).length === 0);
  const withToken = cleanBoxes.filter((entry) => getBoxAssets(entry.box).length > 0);

  const selected = [];
  let total = 0n;
  const tokens = new Map();

  function addBox(entry) {
    selected.push(entry);
    total += BigInt(entry.box.value);
    getBoxAssets(entry.box).forEach((asset) => {
      const current = tokens.get(asset.tokenId) || 0n;
      tokens.set(asset.tokenId, current + BigInt(asset.amount));
    });
  }

  const candidates = [...noToken, ...withToken];
  for (const entry of candidates) {
    addBox(entry);
    const hasTokens = tokens.size > 0;
    const requiredChange = hasTokens ? minChangeNano : 0n;
    if (total >= requiredNano && total - requiredNano >= requiredChange) {
      break;
    }
  }

  if (total < requiredNano) {
    throw new Error('Insufficient ERG balance to fund the mint.');
  }
  const hasTokens = tokens.size > 0;
  if (hasTokens && total - requiredNano < minChangeNano) {
    throw new Error('Unable to reserve enough ERG for change with tokens.');
  }

  return { selected, total, tokens };
}

async function loadDexyState(session) {
  const config = getDexyConfig(session.network);
  const endpoint = session.endpoint;
  const [
    info,
    bankBox,
    buybackBox,
    freeMintBox,
    arbMintBox,
    oracleBox,
    lpBox,
    trackingBox,
  ] = await Promise.all([
    nodeGetJson(endpoint, '/info', session.apiKey),
    fetchUnspentBoxByTokenId(endpoint, config.bankNft, session.apiKey),
    fetchUnspentBoxByTokenId(endpoint, config.buybackNft, session.apiKey),
    fetchUnspentBoxByTokenId(endpoint, config.freeMintNft, session.apiKey),
    fetchUnspentBoxByTokenId(endpoint, config.arbitrageMintNft, session.apiKey),
    fetchUnspentBoxByTokenId(endpoint, config.oraclePoolNft, session.apiKey),
    fetchUnspentBoxByTokenId(endpoint, config.lpNft, session.apiKey),
    fetchUnspentBoxByTokenId(endpoint, config.tracking101Nft, session.apiKey),
  ]);

  const height = Number(info.fullHeight || info.headersHeight || info.bestFullHeight || 0);
  if (!height) {
    throw new Error('Unable to determine node height.');
  }

  const bankAssets = getBoxAssets(bankBox);
  const bankDexyAsset = bankAssets.find(
    (asset) => normalizeTokenId(asset.tokenId) !== normalizeTokenId(config.bankNft),
  );
  if (!bankDexyAsset || !bankDexyAsset.tokenId) {
    throw new Error('Bank box is missing the Dexy token.');
  }
  const dexyTokenId = bankDexyAsset.tokenId;
  const bankDexyAmount = BigInt(bankDexyAsset.amount);
  const useTokenInfo = await fetchTokenInfo(
    endpoint,
    dexyTokenId,
    session.apiKey,
  ).catch(() => null);

  const oracleRateRaw = decodeSValueLong(oracleBox.additionalRegisters.R4);
  const lpReservesX = BigInt(lpBox.value);
  const lpAssets = getBoxAssets(lpBox);
  const lpReservesY = findAssetAmount(lpBox, dexyTokenId);
  const lpTokenId = dexyTokenId;
  if (lpReservesY <= 0n) {
    if (!useTokenInfo) {
      throw new Error(
        `Dexy token ${dexyTokenId} not found on ${session.network}.`,
      );
    }
    const lpTokens = lpAssets.map((asset) => asset.tokenId).filter(Boolean);
    const tokenList = lpTokens.length ? lpTokens.join(', ') : 'none';
    throw new Error(
      `LP box missing Dexy token ${dexyTokenId}. LP tokens: ${tokenList}.`,
    );
  }
  const lpRate = lpReservesX / lpReservesY;
  const tokenDecimalsDetected =
    useTokenInfo && Number.isFinite(Number(useTokenInfo.decimals))
      ? Number(useTokenInfo.decimals)
      : null;
  const decimalsValue =
    Number.isFinite(tokenDecimalsDetected) &&
    tokenDecimalsDetected >= 0 &&
    tokenDecimalsDetected <= 18
      ? tokenDecimalsDetected
      : DEXY_DECIMALS;
  const tokenScale = 10n ** BigInt(decimalsValue);
  const oracleRate = oracleRateRaw / tokenScale;

  const bankRate =
    (oracleRate * (DEXY_CONSTANTS.feeDenom + DEXY_CONSTANTS.bankFeeNum)) /
    DEXY_CONSTANTS.feeDenom;
  const buybackRate =
    (oracleRate * DEXY_CONSTANTS.buybackFeeNum) / DEXY_CONSTANTS.feeDenom;
  const totalRate = bankRate + buybackRate;

  const freeR4 = decodeSValueInt(freeMintBox.additionalRegisters.R4);
  const freeR5 = decodeSValueLong(freeMintBox.additionalRegisters.R5);
  const freeReset = height > freeR4;
  const freeMaxAllowed = lpReservesY / 100n;
  const freeAvailable = freeReset ? freeMaxAllowed : freeR5;
  const freeEligible =
    lpRate * 100n > oracleRate * DEXY_CONSTANTS.freeMintThresholdPercent &&
    freeAvailable > 0n;

  const arbR4 = decodeSValueInt(arbMintBox.additionalRegisters.R4);
  const arbR5 = decodeSValueLong(arbMintBox.additionalRegisters.R5);
  const arbReset = height > arbR4;
  const maxAllowed = totalRate > 0n && lpReservesX > totalRate * lpReservesY
    ? (lpReservesX - totalRate * lpReservesY) / totalRate
    : 0n;
  const arbAvailable = arbReset ? maxAllowed : arbR5;
  const trackingHeight = decodeSValueInt(trackingBox.additionalRegisters.R7);
  const arbEligible =
    trackingHeight < height - DEXY_CONSTANTS.arbPeriod &&
    lpRate * 100n > DEXY_CONSTANTS.arbThresholdPercent * totalRate &&
    arbAvailable > 0n;

  return {
    config,
    height,
    oracleRateRaw,
    oracleRate,
    lpReservesX,
    lpReservesY,
    lpRate,
    lpTokenId,
    lpAssets,
    dexyTokenId,
    configuredTokenId: config.useTokenId,
    bankDexyAmount,
    decimals: decimalsValue,
    tokenInfo: useTokenInfo,
    tokenDecimalsDetected,
    bankRate,
    buybackRate,
    totalRate,
    free: {
      box: freeMintBox,
      r4: freeR4,
      r5: freeR5,
      reset: freeReset,
      maxIfReset: freeMaxAllowed,
      available: freeAvailable,
      eligible: freeEligible,
    },
    arb: {
      box: arbMintBox,
      r4: arbR4,
      r5: arbR5,
      reset: arbReset,
      available: arbAvailable,
      eligible: arbEligible,
      trackingHeight,
    },
    bankBox,
    buybackBox,
    oracleBox,
    lpBox,
    trackingBox,
  };
}

function resolveDexyMode(mode, freeEligible, arbEligible) {
  const normalized = (mode || 'auto').toLowerCase();
  if (normalized === 'free') {
    if (!freeEligible) {
      throw new Error('Free mint is not available.');
    }
    return 'free';
  }
  if (normalized === 'arbitrage') {
    if (!arbEligible) {
      throw new Error('Arbitrage mint is not available.');
    }
    return 'arbitrage';
  }
  if (freeEligible) {
    return 'free';
  }
  if (arbEligible) {
    return 'arbitrage';
  }
  throw new Error('No minting path is available right now.');
}

function buildDexyQuote(state, ergAmount, mode) {
  const ergInputNano = parseNanoErg(ergAmount);
  if (ergInputNano <= 0n) {
    throw new Error('ERG amount must be greater than zero.');
  }

  const resolvedMode = resolveDexyMode(
    mode,
    state.free.eligible,
    state.arb.eligible,
  );
  const available =
    resolvedMode === 'free' ? state.free.available : state.arb.available;

  if (state.totalRate <= 0n) {
    throw new Error('Dexy rate is unavailable.');
  }

  let minted = ergInputNano / state.totalRate;
  if (minted > available) {
    minted = available;
  }
  if (minted <= 0n) {
    throw new Error('Mint amount too small for the provided ERG.');
  }

  const bankErg = minted * state.bankRate;
  const buybackErg = minted * state.buybackRate;
  const ergSpend = bankErg + buybackErg;
  const ergUnused = ergInputNano - ergSpend;

  return {
    mode: resolvedMode,
    ergInputNano,
    minted,
    bankErg,
    buybackErg,
    available,
    ergSpend,
    ergUnused,
  };
}

function formatDexyStatus(state, session) {
  const oraclePriceNano = state.oracleRateRaw;
  const decimals =
    typeof state.decimals === 'number' ? state.decimals : DEXY_DECIMALS;
  const tokenScale = 10n ** BigInt(decimals);
  const lpPriceNano = state.lpRate * tokenScale;
  const bankRateNano = state.bankRate * tokenScale;
  const buybackRateNano = state.buybackRate * tokenScale;
  const totalRateNano = state.totalRate * tokenScale;
  const detected =
    typeof state.tokenDecimalsDetected === 'number'
      ? state.tokenDecimalsDetected
      : null;

  return {
    connected: true,
    address: session.address,
    network: session.network,
    height: state.height,
    useToken: {
      tokenId: state.dexyTokenId || state.configuredTokenId,
      name: state.tokenInfo?.name,
      decimals,
      configuredTokenId: state.configuredTokenId,
      detectedDecimals:
        detected !== null && detected !== decimals ? detected : undefined,
    },
    lpTokenId: state.lpTokenId || state.dexyTokenId || state.configuredTokenId,
    lpTokenMatch:
      normalizeTokenId(state.lpTokenId || state.dexyTokenId) ===
      normalizeTokenId(state.configuredTokenId),
    bankTokenId: state.dexyTokenId || state.configuredTokenId,
    bankTokenAmount: formatTokenAmount(state.bankDexyAmount, decimals),
    bankTokenAmountRaw: state.bankDexyAmount.toString(),
    lpAssets: Array.isArray(state.lpAssets)
      ? state.lpAssets.map((asset) => ({
          tokenId: asset.tokenId,
          amount: asset.amount,
        }))
      : [],
    oraclePriceErg: formatNanoErg(oraclePriceNano),
    lpPriceErg: formatNanoErg(lpPriceNano),
    bankRateErg: formatNanoErg(bankRateNano),
    buybackRateErg: formatNanoErg(buybackRateNano),
    totalRateErg: formatNanoErg(totalRateNano),
    freeMint: {
      eligible: state.free.eligible,
      available: formatTokenAmount(state.free.available, decimals),
      availableRaw: state.free.available.toString(),
      maxIfReset: formatTokenAmount(state.free.maxIfReset, decimals),
      maxIfResetRaw: state.free.maxIfReset.toString(),
      resetHeight: state.free.r4,
      resetActive: state.free.reset,
    },
    arbMint: {
      eligible: state.arb.eligible,
      available: formatTokenAmount(state.arb.available, decimals),
      availableRaw: state.arb.available.toString(),
      resetHeight: state.arb.r4,
      trackingHeight: state.arb.trackingHeight,
    },
    lpReserves: formatTokenAmount(state.lpReservesY, decimals),
    lpReservesRaw: state.lpReservesY.toString(),
  };
}

function formatDexyQuoteResponse(state, quote) {
  const decimals =
    typeof state.decimals === 'number' ? state.decimals : DEXY_DECIMALS;
  return {
    mode: quote.mode,
    ergInput: formatNanoErg(quote.ergInputNano),
    ergSpend: formatNanoErg(quote.ergSpend),
    ergUnused: formatNanoErg(quote.ergUnused),
    useMinted: formatTokenAmount(quote.minted, decimals),
    bankErg: formatNanoErg(quote.bankErg),
    buybackErg: formatNanoErg(quote.buybackErg),
    feeErg: formatNanoErg(DEXY_DEFAULT_FEE),
    totalErg: formatNanoErg(quote.ergSpend + DEXY_DEFAULT_FEE + DEXY_MIN_BOX_VALUE),
    available: formatTokenAmount(quote.available, decimals),
    freeEligible: state.free.eligible,
    arbEligible: state.arb.eligible,
  };
}

async function buildDexyMintTransaction(session, ergAmount, mode) {
  const state = await loadDexyState(session);
  const quote = buildDexyQuote(state, ergAmount, mode);
  const config = state.config;
  const mintState = quote.mode === 'free' ? state.free : state.arb;
  const mintBox = mintState.box;
  const dexyTokenId = state.dexyTokenId || config.useTokenId;

  const bankTokenAmount = findAssetAmount(state.bankBox, dexyTokenId);
  if (bankTokenAmount < quote.minted) {
    throw new Error('Bank box does not have enough USE to mint.');
  }

  const nextReset = quote.mode === 'free'
    ? state.height + DEXY_CONSTANTS.freeMintPeriod + DEXY_CONSTANTS.buffer
    : state.height + DEXY_CONSTANTS.arbPeriod + DEXY_CONSTANTS.buffer;
  const updatedR4 = mintState.reset ? nextReset : mintState.r4;
  const updatedR5 = mintState.available - quote.minted;
  if (updatedR5 < 0n) {
    throw new Error('Mint amount exceeds available supply.');
  }

  const mintRegisters = {
    ...(mintBox.additionalRegisters || {}),
    R4: encodeSValueInt(updatedR4),
    R5: encodeSValueLong(updatedR5),
  };
  const buybackRegisters = {
    ...(state.buybackBox.additionalRegisters || {}),
    R4: encodeSValueCollByte(state.buybackBox.boxId),
  };

  const requiredNano =
    quote.bankErg + quote.buybackErg + DEXY_DEFAULT_FEE + DEXY_MIN_BOX_VALUE;
  const walletBoxes = await fetchWalletBoxes(session.endpoint, session.apiKey);
  const walletNano = sumWalletNano(walletBoxes);
  if (walletNano < requiredNano) {
    throw new Error(
      `Wallet needs ${formatNanoErg(requiredNano)} ERG available, but only ` +
        `${formatNanoErg(walletNano)} ERG is spendable. Fund the node wallet or ` +
        'lower the swap amount.',
    );
  }
  const selection = selectWalletInputs(walletBoxes, requiredNano, DEXY_MIN_BOX_VALUE);

  const mintOutputValue = DEXY_MIN_BOX_VALUE;

  const bankAssets = updateAssetAmount(
    cloneAssets(state.bankBox.assets),
    dexyTokenId,
    bankTokenAmount - quote.minted,
  );

  const mintAddress = await ensureBoxAddress(session.endpoint, session.apiKey, mintBox);
  const bankAddress = await ensureBoxAddress(session.endpoint, session.apiKey, state.bankBox);
  const buybackAddress = await ensureBoxAddress(
    session.endpoint,
    session.apiKey,
    state.buybackBox,
  );
  assertAddress('Mint contract', mintAddress);
  assertAddress('Bank contract', bankAddress);
  assertAddress('Buyback contract', buybackAddress);
  assertAddress('Wallet', session.address);

  const requests = [
    {
      address: mintAddress,
      value: toSafeNumber(BigInt(mintBox.value), 'Mint box value'),
      assets: cloneAssets(mintBox.assets),
      registers: mintRegisters,
    },
    {
      address: bankAddress,
      value: toSafeNumber(BigInt(state.bankBox.value) + quote.bankErg, 'Bank value'),
      assets: bankAssets,
    },
    {
      address: buybackAddress,
      value: toSafeNumber(BigInt(state.buybackBox.value) + quote.buybackErg, 'Buyback value'),
      assets: cloneAssets(state.buybackBox.assets),
      registers: buybackRegisters,
    },
    {
      address: session.address,
      value: toSafeNumber(mintOutputValue, 'Mint output value'),
      assets: [
        {
          tokenId: dexyTokenId,
          amount: toJsonAmount(quote.minted, 'Mint amount'),
        },
      ],
    },
  ];

  const inputBoxes = [
    mintBox,
    state.bankBox,
    state.buybackBox,
    ...selection.selected.map((entry) => entry.box),
  ];
  const inputIds = inputBoxes.map((box) => box.boxId);
  const inputsRaw = await Promise.all(
    inputIds.map((boxId) => fetchBoxBytes(session.endpoint, boxId)),
  );

  const dataBoxIds = [state.oracleBox.boxId, state.lpBox.boxId];
  if (quote.mode === 'arbitrage') {
    dataBoxIds.push(state.trackingBox.boxId);
  }
  const dataInputsRaw = await Promise.all(
    dataBoxIds.map((boxId) => fetchBoxBytes(session.endpoint, boxId)),
  );
  inputsRaw.forEach((bytes, index) => {
    const boxId = inputIds[index] || `input ${index + 1}`;
    assertHexBytes(`Input ${boxId}`, bytes);
  });
  dataInputsRaw.forEach((bytes, index) => {
    const boxId = dataBoxIds[index] || `data input ${index + 1}`;
    assertHexBytes(`Data input ${boxId}`, bytes);
  });
  await assertBoxesUnspent(session.endpoint, session.apiKey, inputIds);
  await assertBoxesUnspent(session.endpoint, session.apiKey, dataBoxIds);

  let unsignedTx;
  try {
    try {
      unsignedTx = await nodePostJson(
        session.endpoint,
        '/wallet/transaction/generateUnsigned',
        session.apiKey,
        {
          requests,
          fee: toSafeNumber(DEXY_DEFAULT_FEE, 'Fee'),
          inputsRaw,
          dataInputsRaw,
        },
      );
    } catch (error) {
      if (!isNoneGetError(error.message || '')) {
        throw error;
      }
      unsignedTx = await nodePostJson(
        session.endpoint,
        '/wallet/transaction/generateUnsigned',
        session.apiKey,
        {
          requests,
          fee: toSafeNumber(DEXY_DEFAULT_FEE, 'Fee'),
          inputs: inputIds,
          dataInputs: dataBoxIds,
        },
      );
    }
  } catch (error) {
    if (isNoneGetError(error.message || '')) {
      throw new Error(
        'Node rejected the mint request (Malformed request: None.get). ' +
          'Check that the contract addresses resolve and all inputs are valid.',
      );
    }
    const summary = parseNotEnoughErgs(error.message || '');
    if (summary) {
      throw new Error(
        `Mint funding failed. Required ${formatNanoErg(requiredNano)} ERG, ` +
          `wallet spendable ${formatNanoErg(walletNano)} ERG, selected ` +
          `${formatNanoErg(selection.total)} ERG (${selection.selected.length} boxes). ` +
          `Node needed ${formatNanoErg(summary.needed)} ERG but found ` +
          `${formatNanoErg(summary.found)} ERG.`,
      );
    }
    const tokenSummary = parseNotEnoughTokens(error.message || '', dexyTokenId);
    if (tokenSummary) {
      if (tokenSummary.needed !== undefined && tokenSummary.found !== undefined) {
        const decimals =
          typeof state.decimals === 'number' ? state.decimals : DEXY_DECIMALS;
        const delta = tokenSummary.needed - tokenSummary.found;
        throw new Error(
          `Mint token mismatch. Required ${formatTokenAmount(tokenSummary.needed, decimals)} USE, ` +
            `found ${formatTokenAmount(tokenSummary.found, decimals)} USE ` +
            `(delta ${formatTokenAmount(delta < 0n ? -delta : delta, decimals)}). ` +
            'This usually means a large token amount was rounded in a JSON response.',
        );
      }
      throw new Error(tokenSummary.message);
    }
    throw error;
  }

  const inputMap = new Map(
    (unsignedTx.inputs || []).map((input) => [input.boxId, input]),
  );
  const inputIdSet = new Set(inputIds);
  const orderedInputs = [];
  inputIds.forEach((boxId) => {
    const input = inputMap.get(boxId);
    if (!input) {
      throw new Error('Unable to map unsigned inputs.');
    }
    orderedInputs.push({ ...input });
  });
  (unsignedTx.inputs || []).forEach((input) => {
    if (!inputIdSet.has(input.boxId)) {
      orderedInputs.push({ ...input });
    }
  });
  unsignedTx.inputs = orderedInputs;

  const dataInputMap = new Map(
    (unsignedTx.dataInputs || []).map((input) => [input.boxId, input]),
  );
  unsignedTx.dataInputs = dataBoxIds.map((boxId) => {
    const input = dataInputMap.get(boxId);
    if (!input) {
      throw new Error('Unable to map unsigned data inputs.');
    }
    return { ...input };
  });

  const buybackIndex = unsignedTx.inputs.findIndex(
    (input) => input.boxId === state.buybackBox.boxId,
  );
  if (buybackIndex < 0) {
    throw new Error('Buyback input missing.');
  }
  unsignedTx.inputs[buybackIndex].extension = {
    '0': encodeSValueInt(1),
  };

  const signedTx = await nodePostJson(
    session.endpoint,
    '/wallet/transaction/sign',
    session.apiKey,
    {
      tx: unsignedTx,
      inputsRaw,
      dataInputsRaw,
    },
  );

  const broadcast = await nodePostJson(
    session.endpoint,
    '/transactions',
    session.apiKey,
    signedTx,
  );

  return {
    txId: typeof broadcast === 'string' ? broadcast : broadcast?.id || broadcast,
    quote: formatDexyQuoteResponse(state, quote),
  };
}

async function handleWalletConnect(req, res) {
  const body = await readJsonBody(req);
  const endpoint = normalizeNodeEndpoint(
    body.endpoint || body.nodeEndpoint || DEFAULT_NODE_ENDPOINT,
  );
  if (!endpoint) {
    sendJson(res, 400, { error: 'Missing Ergo node endpoint.' });
    return;
  }

  let info = null;
  try {
    info = await fetchNodeInfo(endpoint, 1200);
  } catch (error) {
    sendJson(res, 200, {
      status: 'offline',
      error: 'Ergo node not reachable.',
      endpoint,
    });
    return;
  }

  const apiKey =
    (typeof body.token === 'string' && body.token.trim()) ||
    (typeof body.apiKey === 'string' && body.apiKey.trim()) ||
    '';
  const network = parseNetworkFromInfo(info, body.network);

  if (!apiKey) {
    sendJson(res, 200, {
      status: 'needs_key',
      message: 'Ergo node API key required to access wallet addresses.',
      endpoint,
      network,
    });
    return;
  }

  let addresses = [];
  try {
    addresses = await fetchWalletAddresses(endpoint, apiKey);
  } catch (error) {
    sendJson(res, 200, {
      status: 'needs_key',
      message: 'Unable to read wallet addresses. Check the API key.',
      endpoint,
      network,
    });
    return;
  }

  if (!addresses.length) {
    sendJson(res, 200, {
      status: 'empty',
      message: 'No wallet addresses returned by the node.',
      endpoint,
      network,
    });
    return;
  }

  const sessionId = generateSessionId();
  const session = {
    sessionId,
    endpoint,
    apiKey,
    network,
    address: addresses[0] || null,
    addresses,
    createdAt: Date.now(),
  };
  sessions.set(sessionId, session);

  sendJson(res, 200, {
    status: 'connected',
    sessionId,
    address: session.address,
    addresses: session.addresses,
    network,
  });
}

async function handleWalletStatus(req, res, url) {
  const sessionId = url.searchParams.get('session');
  if (!sessionId || !sessions.has(sessionId)) {
    sendJson(res, 200, { connected: false });
    return;
  }
  const session = sessions.get(sessionId);
  let addresses = [];
  try {
    addresses = await fetchWalletAddresses(session.endpoint, session.apiKey);
  } catch (error) {
    sendJson(res, 200, {
      connected: false,
      error: 'Unable to reach the Ergo node wallet.',
    });
    return;
  }
  const previousAddress = session.address;
  session.addresses = addresses;
  session.address = addresses[0] || null;
  if (previousAddress !== session.address) {
    session.balanceCache = null;
    session.balanceCacheAt = 0;
  }
  if (!session.address) {
    sendJson(res, 200, { connected: false, error: 'No wallet address found.' });
    return;
  }

  if (!session.balanceCache || Date.now() - session.balanceCacheAt > 30_000) {
    session.balanceCache = await fetchErgoBalance(
      session.address,
      session.network,
    );
    session.balanceCacheAt = Date.now();
  }
  const walletBoxes = await fetchWalletBoxes(session.endpoint, session.apiKey);
  const walletNano = sumWalletNano(walletBoxes);

  sendJson(res, 200, {
    connected: true,
    address: session.address,
    addresses: session.addresses,
    network: session.balanceCache.network,
    balance: session.balanceCache.balance,
    tokens: session.balanceCache.tokens,
    spendable: formatNanoErg(walletNano),
    utxoCount: walletBoxes.length,
  });
}

async function handleWalletDisconnect(req, res) {
  const body = await readJsonBody(req);
  if (body.sessionId && sessions.has(body.sessionId)) {
    sessions.delete(body.sessionId);
  }
  sendJson(res, 200, { disconnected: true });
}

function getSession(sessionId) {
  if (!sessionId || !sessions.has(sessionId)) {
    return null;
  }
  return sessions.get(sessionId);
}

async function handleDexyStatus(req, res, url) {
  const sessionId = url.searchParams.get('session');
  const session = getSession(sessionId);
  if (!session) {
    sendJson(res, 200, { connected: false, dexyReady: false });
    return;
  }
  try {
    const state = await loadDexyState(session);
    sendJson(res, 200, {
      ...formatDexyStatus(state, session),
      dexyReady: true,
    });
  } catch (error) {
    sendJson(res, 200, {
      connected: true,
      dexyReady: false,
      address: session.address,
      network: session.network,
      error: error.message,
    });
  }
}

async function handleDexyQuote(req, res) {
  const body = await readJsonBody(req);
  const session = getSession(body.sessionId);
  if (!session) {
    sendJson(res, 400, { error: 'Wallet session not found.' });
    return;
  }
  try {
    const state = await loadDexyState(session);
    const quote = buildDexyQuote(state, body.ergAmount, body.mode);
    sendJson(res, 200, formatDexyQuoteResponse(state, quote));
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}

async function handleDexyMint(req, res) {
  const body = await readJsonBody(req);
  const session = getSession(body.sessionId);
  if (!session) {
    sendJson(res, 400, { error: 'Wallet session not found.' });
    return;
  }
  try {
    const result = await buildDexyMintTransaction(
      session,
      body.ergAmount,
      body.mode,
    );
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}

async function handleMinerStart(req, res) {
  if (
    minerProcess &&
    minerProcess.external &&
    !minerProcess.unknownPid &&
    !isProcessAlive(minerProcess.pid)
  ) {
    minerProcess = null;
    minerConfig = null;
    minerStats = null;
    minerStatsAt = 0;
  }
  if (minerProcess) {
    sendJson(res, 200, { running: true, pid: minerProcess.pid });
    return;
  }
  const body = await readJsonBody(req);
  if (!body.path || !body.pool || !body.address) {
    sendJson(res, 400, { error: 'Missing Rigel path, pool, or address.' });
    return;
  }
  if (!fs.existsSync(body.path)) {
    sendJson(res, 400, { error: 'Rigel path not found.' });
    return;
  }

  const apiBind = parseApiBind(body.apiBind);
  const config = {
    path: body.path,
    pool: body.pool,
    worker: body.worker || '',
    address: body.address,
    args: body.args || '',
    apiBind,
    apiUrl: apiBindToUrl(body.apiUrl || apiBind),
  };

  const args = buildRigelArgs(config);
  const wantsConsole = body.openConsole === true;
  try {
    if (wantsConsole && process.platform === 'win32') {
      const escapedPath = config.path.replace(/'/g, "''");
      const escapedCwd = path.dirname(config.path).replace(/'/g, "''");
      const argList = args
        .map((arg) => `'${String(arg).replace(/'/g, "''")}'`)
        .join(',');
      const psCommand =
        `$ErrorActionPreference='Stop'; ` +
        `$p = Start-Process -FilePath '${escapedPath}' ` +
        `-ArgumentList @(${argList}) -WorkingDirectory '${escapedCwd}' ` +
        '-WindowStyle Normal -PassThru; ' +
        '[Console]::Out.WriteLine($p.Id)';
      const output = await runCommandCapture(
        'powershell',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          psCommand,
        ],
        { direct: true },
      );
      let pid = NaN;
      const match = String(output.stdout || '').match(/(\d+)/);
      if (match) {
        pid = Number(match[1]);
      }
      if (!Number.isFinite(pid)) {
        const exeName = path.basename(config.path).replace(/'/g, "''");
        const lookupCommand =
          `$p = Get-CimInstance Win32_Process -Filter \"Name='${exeName}'\" ` +
          `| Where-Object { $_.ExecutablePath -eq '${escapedPath}' } ` +
          '| Select-Object -First 1 -ExpandProperty ProcessId; ' +
          'if ($p) { [Console]::Out.WriteLine($p) }';
        const lookup = await runCommandCapture(
          'powershell',
          [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-Command',
            lookupCommand,
          ],
          { direct: true },
        );
        const lookupMatch = String(lookup.stdout || '').match(/(\d+)/);
        if (lookupMatch) {
          pid = Number(lookupMatch[1]);
        }
      }
      const unknownPid = !Number.isFinite(pid);
      const exeName = path.basename(config.path);
      if (unknownPid) {
        pid = null;
      }
      minerProcess = {
        pid,
        external: true,
        unknownPid,
        kill: () => {
          if (pid && Number.isFinite(pid)) {
            try {
              process.kill(pid);
              return;
            } catch (error) {
              // Fall back to taskkill.
            }
          }
          if (process.platform === 'win32') {
            spawn('taskkill', ['/IM', exeName, '/T', '/F'], {
              windowsHide: true,
            });
          }
        },
      };
      minerConfig = {
        ...config,
        startedAt: Date.now(),
      };
    } else {
      minerProcess = spawn(config.path, args, { windowsHide: true });
      minerConfig = {
        ...config,
        startedAt: Date.now(),
      };

      minerProcess.on('error', (error) => {
        console.error('Rigel Miner failed to start:', error);
        minerProcess = null;
        minerConfig = null;
        minerStats = null;
        minerStatsAt = 0;
      });

      minerProcess.on('exit', () => {
        minerProcess = null;
        minerConfig = null;
        minerStats = null;
        minerStatsAt = 0;
      });
    }

      sendJson(res, 200, {
        running: true,
        pid: minerProcess.pid || null,
        pidUnknown: minerProcess.unknownPid || false,
        apiUrl: minerConfig.apiUrl,
        console: wantsConsole && process.platform === 'win32',
      });
  } catch (error) {
    sendJson(res, 500, {
      error: error && error.message ? error.message : 'Failed to launch Rigel Miner.',
    });
  }
}

async function handleMinerStop(req, res) {
  if (!minerProcess) {
    sendJson(res, 200, { running: false });
    return;
  }
  try {
    if (typeof minerProcess.kill === 'function') {
      minerProcess.kill();
    } else if (minerProcess.pid) {
      process.kill(minerProcess.pid);
    }
  } catch (error) {
    // Ignore if process already exited.
  }
  minerProcess = null;
  minerConfig = null;
  minerStats = null;
  minerStatsAt = 0;
  sendJson(res, 200, { running: false });
}

async function handleMinerStatus(req, res) {
  if (
    minerProcess &&
    minerProcess.external &&
    !minerProcess.unknownPid &&
    !isProcessAlive(minerProcess.pid)
  ) {
    minerProcess = null;
    minerConfig = null;
    minerStats = null;
    minerStatsAt = 0;
  }
  sendJson(res, 200, {
    running: Boolean(minerProcess),
    pid: minerProcess ? minerProcess.pid : null,
    apiUrl: minerConfig ? minerConfig.apiUrl : null,
  });
}

async function handleMinerStats(req, res) {
  if (minerProcess && minerProcess.external && !isProcessAlive(minerProcess.pid)) {
    minerProcess = null;
    minerConfig = null;
    minerStats = null;
    minerStatsAt = 0;
  }
  if (!minerProcess || !minerConfig) {
    sendJson(res, 200, { running: false });
    return;
  }

  const now = Date.now();
  if (minerStats && now - minerStatsAt < 3000) {
    sendJson(res, 200, { running: true, stats: minerStats });
    return;
  }

  const result = await fetchMinerStats(minerConfig.apiUrl);
  if (!result) {
    sendJson(res, 200, { running: true, stats: null });
    return;
  }
  const normalized = normalizeMinerStats(result.data);
  minerStats = {
    ...(normalized || {}),
    source: result.source,
    raw: result.data,
  };
  minerStatsAt = now;

  sendJson(res, 200, { running: true, stats: minerStats });
}

async function handleApi(req, res, url) {
  if (req.method === 'POST' && url.pathname === '/api/wallet/connect') {
    await handleWalletConnect(req, res);
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/wallet/status') {
    await handleWalletStatus(req, res, url);
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/wallet/disconnect') {
    await handleWalletDisconnect(req, res);
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/dexy/status') {
    await handleDexyStatus(req, res, url);
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/dexy/quote') {
    await handleDexyQuote(req, res);
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/dexy/mint') {
    await handleDexyMint(req, res);
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/node/scan') {
    const result = await scanLocalNode();
    if (!result) {
      sendJson(res, 200, { found: false });
      return;
    }
    sendJson(res, 200, {
      found: true,
      endpoint: result.endpoint,
      info: result.info,
    });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/miner/start') {
    await handleMinerStart(req, res);
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/miner/stop') {
    await handleMinerStop(req, res);
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/miner/status') {
    await handleMinerStatus(req, res);
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/miner/stats') {
    await handleMinerStats(req, res);
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/tasks/rigel/install') {
    const task = createTask('rigel-install');
    sendJson(res, 202, { taskId: task.id });
    runRigelInstall(task)
      .then(() => finalizeTask(task))
      .catch((error) => finalizeTask(task, error));
    return;
  }
  if (req.method === 'GET' && url.pathname.startsWith('/api/tasks/')) {
    const parts = url.pathname.split('/').filter(Boolean);
    const taskId = parts[2];
    if (!taskId || !tasks.has(taskId)) {
      sendJson(res, 404, { error: 'Task not found' });
      return;
    }
    const task = tasks.get(taskId);
    sendJson(res, 200, task);
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
}

function handleStatic(req, res, url) {
  const pathname = normalizePathname(url.pathname);
  const target = pathname === '/' ? '/index.html' : pathname;
  const filePath = safeJoin(ROOT, target);

  if (!filePath) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      sendText(res, 404, 'Not found');
      return;
    }
    const ext = path.extname(filePath);
    const mime = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = normalizePathname(url.pathname);

  if (pathname.startsWith('/api/')) {
    await handleApi(req, res, url);
    return;
  }

  handleStatic(req, res, url);
});

server.listen(PORT, () => {
  console.log(`StableMiner UI running at http://localhost:${PORT}`);
});

process.on('SIGINT', () => {
  if (minerProcess) {
    try {
      minerProcess.kill();
    } catch (error) {
      // Ignore shutdown errors.
    }
  }
  process.exit(0);
});
