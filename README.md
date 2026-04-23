# Image Chat Demo

一个很轻的聊天式生图网页，适合拿 `Sub2API / OpenAI 兼容 Images API` 快速试图。
支持两种模式：

- 纯文本生图：走 `/v1/images/generations`
- 上传参考图后聊天改图：走 `/v1/images/edits`

## 启动

```bash
cd /Users/sutong/yunqi/image-chat-demo
npm start
```

打开：

```text
http://127.0.0.1:3187
```

## 用法

1. 在左侧填入 `Base URL`，例如 `http://154.26.182.225`
2. 填入你的 `API Key`
3. 选择模型与尺寸
4. 可选：先上传一张或多张参考图
5. 在输入框里写提示词，点击 `生成图片`

## 说明

- 页面通过本地 `server.js` 自动转发到上游 `generations` 或 `edits`
- 图片默认按 `b64_json` 返回，并在前端展示
- 配置、聊天记录、上传图和生成结果保存在浏览器本地存储（LocalStorage + IndexedDB）
