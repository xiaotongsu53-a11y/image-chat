const storageKey = 'image-chat-demo-config-v1';
const sessionKey = 'image-chat-demo-session-v1';
const DEFAULT_BASE_URL = 'http://154.26.182.225';
const DEFAULT_API_KEY = 'sk-bfa9cc524cc2343d12d6d22ee8b49a17aa20e165066f1f1816228227bb488a4c';
const DB_NAME = 'image-chat-demo-db';
const DB_VERSION = 1;
const STORE_NAME = 'session';

const state = {
  config: {
    baseUrl: DEFAULT_BASE_URL,
    apiKey: DEFAULT_API_KEY,
    model: 'gpt-image-2',
    size: '1024x1024'
  },
  messages: [],
  images: [],
  composerImages: [],
  generating: false
};

const dom = {
  configForm: document.getElementById('config-form'),
  promptForm: document.getElementById('prompt-form'),
  baseUrl: document.getElementById('base-url'),
  apiKey: document.getElementById('api-key'),
  model: document.getElementById('model'),
  size: document.getElementById('size'),
  promptInput: document.getElementById('prompt-input'),
  imageInput: document.getElementById('image-input'),
  attachmentStrip: document.getElementById('attachment-strip'),
  messages: document.getElementById('messages'),
  heroState: document.getElementById('hero-state'),
  gallery: document.getElementById('gallery'),
  galleryCount: document.getElementById('gallery-count'),
  statusPill: document.getElementById('status-pill'),
  clearChat: document.getElementById('clear-chat'),
  previewDialog: document.getElementById('preview-dialog'),
  previewImage: document.getElementById('preview-image'),
  previewClose: document.getElementById('preview-close'),
  messageTemplate: document.getElementById('message-template'),
  galleryTemplate: document.getElementById('gallery-item-template'),
  generateButton: document.getElementById('generate-button')
};

let dbPromise = null;

function openDatabase() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('当前浏览器不支持 IndexedDB'));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('打开 IndexedDB 失败'));
  });

  return dbPromise;
}

async function readDbValue(key) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(key);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('读取会话失败'));
  });
}

async function writeDbValue(key, value) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(value, key);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error('保存会话失败'));
  });
}

async function deleteDbValue(key) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(key);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error('删除会话失败'));
  });
}

function loadConfig() {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return;
    const saved = JSON.parse(raw);
    Object.assign(state.config, saved);
    if (!state.config.baseUrl) {
      state.config.baseUrl = DEFAULT_BASE_URL;
    }
    if (!state.config.apiKey) {
      state.config.apiKey = DEFAULT_API_KEY;
    }
  } catch {
    // ignore
  }
}

function saveConfig() {
  localStorage.setItem(storageKey, JSON.stringify(state.config));
}

async function loadSession() {
  try {
    const saved = await readDbValue(sessionKey);
    if (!saved) return;
    state.messages = Array.isArray(saved.messages) ? saved.messages : [];
    state.images = Array.isArray(saved.images) ? saved.images : [];
  } catch {
    state.messages = [];
    state.images = [];
  }
}

async function saveSession() {
  try {
    await writeDbValue(sessionKey, {
      messages: state.messages,
      images: state.images
    });
  } catch (error) {
    console.error(error);
    setStatus('保存历史失败');
  }
}

function syncConfigToInputs() {
  dom.baseUrl.value = state.config.baseUrl;
  dom.apiKey.value = state.config.apiKey;
  dom.model.value = state.config.model;
  dom.size.value = state.config.size;
}

function readConfigFromInputs() {
  state.config.baseUrl = dom.baseUrl.value.trim();
  state.config.apiKey = dom.apiKey.value.trim();
  state.config.model = dom.model.value;
  state.config.size = dom.size.value;
  saveConfig();
}

function setStatus(text, busy = false) {
  dom.statusPill.textContent = text;
  dom.statusPill.style.background = busy ? 'rgba(197, 235, 212, 0.16)' : 'rgba(255,255,255,0.08)';
}

function renderMessage(role, content, attachments = []) {
  const fragment = dom.messageTemplate.content.cloneNode(true);
  const message = fragment.querySelector('.message');
  const attachmentBox = fragment.querySelector('.message-attachments');
  message.dataset.role = role;
  fragment.querySelector('.message-role').textContent = role === 'user' ? 'You' : 'Assistant';
  fragment.querySelector('.message-body').textContent = content;

  if (Array.isArray(attachments) && attachments.length) {
    attachmentBox.hidden = false;
    attachments.forEach((attachment) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'message-attachment';

      const img = document.createElement('img');
      img.src = attachment.dataUrl;
      img.alt = attachment.name || '上传图片';

      button.appendChild(img);
      button.addEventListener('click', () => openPreview(attachment.dataUrl));
      attachmentBox.appendChild(button);
    });
  }

  dom.messages.appendChild(fragment);
}

function appendMessage(role, content, attachments = []) {
  state.messages.push({ role, content, attachments });
  void saveSession();
  renderMessage(role, content, attachments);
  dom.messages.scrollTop = dom.messages.scrollHeight;
}

function renderHero(image) {
  dom.heroState.classList.remove('loading');
  dom.heroState.innerHTML = '';
  if (!image) {
    dom.heroState.innerHTML = '<p>第一张图会出现在这里。</p>';
    return;
  }
  const img = document.createElement('img');
  img.src = image.dataUrl;
  img.alt = image.revisedPrompt || '生成图片';
  dom.heroState.appendChild(img);
}

function openPreview(src) {
  dom.previewImage.src = src;
  dom.previewDialog.showModal();
}

function renderComposerImages() {
  dom.attachmentStrip.innerHTML = '';
  dom.attachmentStrip.hidden = state.composerImages.length === 0;

  state.composerImages.forEach((attachment) => {
    const chip = document.createElement('div');
    chip.className = 'attachment-chip';

    const img = document.createElement('img');
    img.src = attachment.dataUrl;
    img.alt = attachment.name;

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'attachment-remove';
    removeButton.textContent = '×';
    removeButton.addEventListener('click', () => {
      state.composerImages = state.composerImages.filter((item) => item.id !== attachment.id);
      renderComposerImages();
    });

    chip.appendChild(img);
    chip.appendChild(removeButton);
    dom.attachmentStrip.appendChild(chip);
  });
}

function clearComposerImages() {
  state.composerImages = [];
  dom.imageInput.value = '';
  renderComposerImages();
}

function renderGalleryItem(image, index) {
  const fragment = dom.galleryTemplate.content.cloneNode(true);
  const button = fragment.querySelector('.gallery-thumb');
  const img = fragment.querySelector('img');
  const title = fragment.querySelector('.gallery-title');
  const download = fragment.querySelector('.gallery-download');
  const label = image.revisedPrompt || image.prompt || `生成结果 ${index + 1}`;

  img.src = image.dataUrl;
  img.alt = label;
  button.addEventListener('click', () => openPreview(image.dataUrl));
  title.textContent = label;
  download.href = image.dataUrl;
  download.download = image.fileName || `image-chat-${image.id || Date.now()}-${index + 1}.png`;

  dom.gallery.prepend(fragment);
}

function addImages(prompt, images) {
  const createdAt = Date.now();

  images.forEach((image, index) => {
    const savedImage = {
      ...image,
      prompt,
      fileName: `image-chat-${createdAt}-${index + 1}.png`
    };
    state.images.push(savedImage);
    renderGalleryItem(savedImage, state.images.length - 1);
  });

  void saveSession();
  dom.galleryCount.textContent = `${dom.gallery.children.length} 张`;
  renderHero(images[0]);
}

function clearChat() {
  state.messages = [];
  state.images = [];
  clearComposerImages();
  dom.messages.innerHTML = '';
  dom.gallery.innerHTML = '';
  dom.galleryCount.textContent = '0 张';
  renderHero(null);
  void deleteDbValue(sessionKey);
  setStatus('等待生成');
}

function restoreSession() {
  dom.messages.innerHTML = '';
  dom.gallery.innerHTML = '';

  state.messages.forEach(({ role, content, attachments }) => renderMessage(role, content, attachments));
  state.images.forEach((image, index) => renderGalleryItem(image, index));

  dom.galleryCount.textContent = `${state.images.length} 张`;
  if (state.images.length) {
    renderHero(state.images[state.images.length - 1]);
    setStatus('已恢复历史记录');
  } else if (state.messages.length) {
    renderHero(null);
    setStatus('只恢复了对话，暂无图片结果');
  } else {
    renderHero(null);
    setStatus('当前空闲');
  }

  dom.messages.scrollTop = dom.messages.scrollHeight;
}

async function generate(prompt) {
  readConfigFromInputs();

  const missingFields = [];
  if (!state.config.baseUrl) missingFields.push('Base URL');
  if (!state.config.apiKey) missingFields.push('API Key');

  if (missingFields.length) {
    appendMessage('assistant', `先把 ${missingFields.join(' 和 ')} 填好。`);
    return;
  }

  state.generating = true;
  dom.generateButton.disabled = true;
  dom.heroState.classList.add('loading');
  setStatus('生成中...', true);
  const userAttachments = state.composerImages.map((attachment) => ({ ...attachment }));
  appendMessage('user', prompt, userAttachments);
  clearComposerImages();

  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ...state.config,
        prompt,
        attachments: userAttachments,
        n: 1
      })
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || '生成失败');
    }

    addImages(prompt, payload.images);
    const actionLabel = payload.mode === 'edits' ? '已完成带图改图' : '已生成';
    appendMessage('assistant', `${actionLabel} ${payload.images.length} 张图片。`);
    setStatus('生成完成');
  } catch (error) {
    dom.heroState.classList.remove('loading');
    appendMessage('assistant', error.message || '生成失败');
    setStatus('请求失败');
  } finally {
    state.generating = false;
    dom.generateButton.disabled = false;
  }
}

dom.configForm.addEventListener('input', readConfigFromInputs);
dom.imageInput.addEventListener('change', async (event) => {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;

  const nextAttachments = await Promise.all(
    files.map(
      (file) =>
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () =>
            resolve({
              id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
              name: file.name,
              mimeType: file.type || 'image/png',
              dataUrl: reader.result
            });
          reader.onerror = () => reject(new Error(`读取文件失败: ${file.name}`));
          reader.readAsDataURL(file);
        })
    )
  );

  state.composerImages = [...state.composerImages, ...nextAttachments];
  renderComposerImages();
});

dom.promptForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (state.generating) return;
  const prompt = dom.promptInput.value.trim();
  if (!prompt) return;
  dom.promptInput.value = '';
  await generate(prompt);
});

dom.clearChat.addEventListener('click', clearChat);
dom.previewClose.addEventListener('click', () => dom.previewDialog.close());
dom.previewDialog.addEventListener('click', (event) => {
  const rect = dom.previewDialog.getBoundingClientRect();
  const isInDialog =
    rect.top <= event.clientY &&
    event.clientY <= rect.top + rect.height &&
    rect.left <= event.clientX &&
    event.clientX <= rect.left + rect.width;
  if (!isInDialog) {
    dom.previewDialog.close();
  }
});

async function init() {
  loadConfig();
  await loadSession();
  syncConfigToInputs();
  restoreSession();
  if (!state.messages.length) {
    appendMessage('assistant', '配置好接口后，输入一句提示词就能开始生图。');
  }
}

void init();
