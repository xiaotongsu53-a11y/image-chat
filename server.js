const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const HOST = '127.0.0.1';
const PORT = 3187;
const ROOT = __dirname;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function inferExtension(mimeType) {
  switch (mimeType) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    default:
      return 'bin';
  }
}

function parseDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
    throw new Error('图片附件格式不正确');
  }

  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error('图片附件必须是 base64 data URL');
  }

  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], 'base64')
  };
}

function createMultipartPayload({ model, prompt, size, n, attachments }) {
  const boundary = `----image-chat-demo-${Date.now().toString(16)}`;
  const chunks = [];

  function pushText(name, value) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    chunks.push(
      Buffer.from(`Content-Disposition: form-data; name="${name}"\r\n\r\n${String(value)}\r\n`)
    );
  }

  function pushFile(name, fileName, mimeType, buffer) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    chunks.push(
      Buffer.from(
        `Content-Disposition: form-data; name="${name}"; filename="${fileName}"\r\n` +
          `Content-Type: ${mimeType}\r\n\r\n`
      )
    );
    chunks.push(buffer);
    chunks.push(Buffer.from('\r\n'));
  }

  pushText('model', model);
  pushText('prompt', prompt);
  pushText('size', size);
  pushText('n', n);
  pushText('response_format', 'b64_json');

  attachments.forEach((attachment, index) => {
    const parsed = parseDataUrl(attachment.dataUrl);
    const extension = inferExtension(parsed.mimeType);
    const fileName =
      attachment.name && typeof attachment.name === 'string'
        ? attachment.name
        : `upload-${index + 1}.${extension}`;
    pushFile('image', fileName, parsed.mimeType, parsed.buffer);
  });

  chunks.push(Buffer.from(`--${boundary}--\r\n`));

  return {
    boundary,
    body: Buffer.concat(chunks)
  };
}

function sanitizeBaseUrl(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new Error('缺少 Base URL');
  }

  const url = new URL(input.trim());
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Base URL 只支持 http 或 https');
  }
  url.pathname = '';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function serveStatic(req, res) {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = reqUrl.pathname === '/' ? '/index.html' : reqUrl.pathname;
  const filePath = path.normalize(path.join(ROOT, pathname));

  if (!filePath.startsWith(ROOT)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('请求体不是合法 JSON');
  }
}

async function handleGenerate(req, res) {
  try {
    const body = await readJsonBody(req);
    const baseUrl = sanitizeBaseUrl(body.baseUrl);
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : 'gpt-image-2';
  const size = typeof body.size === 'string' && body.size.trim() ? body.size.trim() : '1024x1024';
  const n = Number.isInteger(body.n) && body.n > 0 && body.n <= 4 ? body.n : 1;
  const attachments = Array.isArray(body.attachments) ? body.attachments : [];

    if (!apiKey) {
      throw new Error('缺少 API Key');
    }
    if (!prompt) {
      throw new Error('请输入提示词');
    }

    const useEdits = attachments.length > 0;
    const endpoint = useEdits ? '/v1/images/edits' : '/v1/images/generations';
    const headers = {
      Authorization: `Bearer ${apiKey}`
    };
    let requestBody = null;

    if (useEdits) {
      const multipart = createMultipartPayload({
        model,
        prompt,
        size,
        n,
        attachments
      });
      headers['Content-Type'] = `multipart/form-data; boundary=${multipart.boundary}`;
      requestBody = multipart.body;
    } else {
      headers['Content-Type'] = 'application/json';
      requestBody = JSON.stringify({
        model,
        prompt,
        n,
        size,
        response_format: 'b64_json'
      });
    }

    const upstreamRes = await fetch(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers,
      body: requestBody
    });

    const text = await upstreamRes.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { raw: text };
    }

    if (!upstreamRes.ok) {
      const message =
        payload?.error?.message ||
        payload?.message ||
        `上游请求失败，状态码 ${upstreamRes.status}`;
      sendJson(res, upstreamRes.status, { error: message, detail: payload });
      return;
    }

    const items = Array.isArray(payload?.data) ? payload.data : [];
    const images = items
      .map((item, index) => {
        const b64 = typeof item?.b64_json === 'string' ? item.b64_json.trim() : '';
        if (!b64) return null;
        return {
          id: `${Date.now()}-${index}`,
          mimeType: 'image/png',
          dataUrl: `data:image/png;base64,${b64}`,
          revisedPrompt: item?.revised_prompt || ''
        };
      })
      .filter(Boolean);

    if (!images.length) {
      sendJson(res, 502, { error: '上游返回成功，但没有图片数据', detail: payload });
      return;
    }

    sendJson(res, 200, {
      created: payload?.created || Date.now(),
      mode: useEdits ? 'edits' : 'generations',
      images
    });
  } catch (error) {
    sendJson(res, 400, { error: error.message || '请求失败' });
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/generate') {
    void handleGenerate(req, res);
    return;
  }

  if (req.method === 'GET') {
    serveStatic(req, res);
    return;
  }

  sendJson(res, 405, { error: 'Method not allowed' });
});

server.listen(PORT, HOST, () => {
  console.log(`Image chat demo running at http://${HOST}:${PORT}`);
});
