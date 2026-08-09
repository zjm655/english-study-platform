# syntax=docker/dockerfile:1
# ====================================================================
# Nuxt 4 全栈英语学习平台 — 多阶段多 target Dockerfile
# 支持 dev / builder / runner / migrator 四种目标，配合不同 compose 文件使用：
#   - dev:      开发模式，源码挂载热重载，端口 5173
#   - builder:  生产构建阶段，产出 .output 自包含产物
#   - runner:   生产运行阶段，仅拷贝 .output，不依赖 node_modules
#   - migrator: 数据库迁移一次性任务，基于 builder（有源码+tsx），跑完即退
# 项目背景：nitro.externals.trace 默认 true，.output 运行时不依赖 node_modules
# ====================================================================

# --------------------------------------------------------------------
# base 阶段：公共基础镜像，启用 corepack（供后续阶段使用 npm/node）
# --------------------------------------------------------------------
FROM node:24-alpine AS base
WORKDIR /app
RUN corepack enable

# --------------------------------------------------------------------
# deps 阶段：安装全部依赖（含 devDependencies，供 dev 与 build 使用）
# 仅依赖 package*.json 变化才重建此层，提升缓存命中率
# --------------------------------------------------------------------
FROM base AS deps
COPY package*.json ./
RUN npm ci

# --------------------------------------------------------------------
# dev 阶段：开发模式 target
# 拷贝全部源码，NODE_ENV=development，启动 nuxt dev（端口 5173）
# 实际使用时通过 compose volume 挂载源码实现热重载
# --------------------------------------------------------------------
FROM deps AS dev
COPY . .
ENV NODE_ENV=development
EXPOSE 5173
CMD ["npm", "run", "dev"]

# --------------------------------------------------------------------
# builder 阶段：生产构建 target
# 基于已装好依赖的 deps 阶段，拷贝源码后执行 nuxt build，产出 .output
# --------------------------------------------------------------------
FROM deps AS builder
COPY . .
ENV NODE_ENV=production
RUN npm run build

# --------------------------------------------------------------------
# runner 阶段：生产运行 target
# 重新基于纯净 node:24-alpine（不继承 deps 的 node_modules），仅拷贝 .output
# 产物自包含，运行时不依赖 node_modules，镜像体积最小
# 健康检查用 alpine 自带的 wget 探测 /api 健康端点
# --------------------------------------------------------------------
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.output ./.output
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/ || exit 1
CMD ["node", ".output/server/index.mjs"]

# --------------------------------------------------------------------
# migrator 阶段：数据库迁移一次性任务 target
# 基于 builder（已有完整源码 + tsx + node_modules），CMD 执行 npm run migrate
# compose 中作为 depends_on 的服务，跑完即退（restart: "no"）
# 迁移源码（server/db/migrate.ts）依赖 tsx 运行，故不能并入 runner 镜像
# 注：migrator 镜像只本地使用不上传，复用 builder 缓存比独立轻量化更务实
#     （独立阶段在 node --import tsx 的 loader 解析上有环境兼容问题）
# --------------------------------------------------------------------
FROM builder AS migrator
CMD ["npm", "run", "migrate"]
