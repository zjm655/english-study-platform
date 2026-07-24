# 英语学习平台（Nuxt 4 全栈）

基于 Nuxt 4 的全栈英语学习平台。学习者按材料片段（segment）依次完成「盲听 → 学习 → 配音 → 影子跟读」四阶段学习流程，完成后可在复习页（`/review`）巩固单词与材料理解；其中「配音」与「影子跟读」接入阿里云智能科教平台进行真实语音评测。

平台另含管理员后台（`/admin`）：材料管理、用户管理、运营统计、阿里云服务（OSS/NLS/智能科教/BSS）与 DeepSeek 监控、日志管理及系统配置。

## Setup

Make sure to install dependencies:

```bash
# npm
npm install

# pnpm
pnpm install

# yarn
yarn install

# bun
bun install
```

## Development Server

Start the development server on `http://localhost:3000`:

```bash
# npm
npm run dev

# pnpm
pnpm dev

# yarn
yarn dev

# bun
bun run dev
```

## Production

Build the application for production:

```bash
# npm
npm run build

# pnpm
pnpm build

# yarn
yarn build

# bun
bun run build
```

Locally preview production build:

```bash
# npm
npm run preview

# pnpm
pnpm preview

# yarn
yarn preview

# bun
bun run preview
```

Check out the [deployment documentation](https://nuxt.com/docs/getting-started/deployment) for more information.
