#!/usr/bin/env bash
# ============================================================================
# 生产部署脚本（单机 pm2 部署，仓库根执行：bash scripts/deploy.sh [--yes] [--clean]）
#
# 固定顺序（硬约束，禁止跳步/换序）：
#   preflight 检查 → 变更预览确认 → git pull --ff-only
#   → 依赖安装（lock 哈希跳过/增量，详见步骤三） → npm run migrate → npm run build
#   → pm2 startOrReload → 验活
#
# 设计原则：
#   - 失败即停（set -e）：任何一步失败都中断并打印现场状态与手工恢复指引；
#   - 只做检查不做自动修复：不 reset --hard、不自动回滚、不自动删 pm2 进程、
#     不擅自改 node 版本 / registry —— 破坏性动作一律留给人工确认后执行；
#   - 先迁移后上流量：新代码可能依赖新表结构（如迁移 023 的埋点三列），
#     顺序颠倒会导致写入静默失败；
#   - 禁止裸 npm i：必须走 npm ci + package-lock（曾因误删 lock 后裸 npm i
#     触发 npm 10.9.8 Arborist 空指针 bug，且裸装会漂移依赖版本）；
#     步骤三的增量 npm install 始终在 package-lock 存在的前提下执行，不属于裸装。
# ============================================================================
set -euo pipefail

# ----- 环境特定参数（可用同名环境变量覆盖，默认值与原硬编码一致） -----
# 仓库根目录：脚本位于 scripts/ 下，默认取脚本所在目录的上一级
APP_DIR="${APP_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
# nvm 安装目录（仅用于 node 缺失时的提示语）
NVM_DIR_DEFAULT="${NVM_DIR_DEFAULT:-/www/server/nvm}"
# 健康检查端口回退值（ecosystem.config.cjs 读不到 PORT 时使用）
DEFAULT_APP_PORT="${DEFAULT_APP_PORT:-3000}"

cd "$APP_DIR"

# ----- 输出工具（终端不支持颜色时自动降级为纯文本） -----
if [ -t 1 ]; then
  C_RED=$'\033[31m'; C_YELLOW=$'\033[33m'; C_GREEN=$'\033[32m'; C_RESET=$'\033[0m'
else
  C_RED=''; C_YELLOW=''; C_GREEN=''; C_RESET=''
fi
info() { echo "${C_GREEN}[deploy]${C_RESET} $*"; }
warn() { echo "${C_YELLOW}[deploy][警告]${C_RESET} $*"; }
die()  { echo "${C_RED}[deploy][中止]${C_RESET} $*" >&2; exit 1; }

# ----- 参数：--yes 跳过交互确认（供无人值守场景）；--clean 强制全量 npm ci -----
AUTO_YES=0
CLEAN_INSTALL=0
for arg in "$@"; do
  case "$arg" in
    --yes) AUTO_YES=1 ;;
    --clean) CLEAN_INSTALL=1 ;;
    *) die "未知参数：$arg
  用法：bash scripts/deploy.sh [--yes] [--clean]
    --yes    跳过交互确认（无人值守场景）
    --clean  删除依赖安装状态文件（node_modules/.deploy-lock-hash），
             强制走全量 npm ci（跳过/增量逻辑异常时的兜底）" ;;
  esac
done

confirm() {
  # $1 = 提示语；--yes 模式直接放行
  if [ "$AUTO_YES" -eq 1 ]; then return 0; fi
  local answer
  read -r -p "$1 输入 yes 继续，其余任意键中止： " answer
  [ "$answer" = "yes" ] || die "用户取消。现场未做任何变更。"
}

# ----- 失败陷阱：打印失败步骤与恢复指引 -----
CURRENT_STEP="初始化"
on_error() {
  echo "" >&2
  echo "${C_RED}=============================================================${C_RESET}" >&2
  echo "${C_RED}[deploy] 部署失败于步骤：${CURRENT_STEP}${C_RESET}" >&2
  echo "[deploy] 当前 commit：$(git rev-parse --short HEAD 2>/dev/null || echo 未知)" >&2
  case "$CURRENT_STEP" in
    构建)
      echo "[deploy] 现场状态：pm2 旧进程仍在内存中正常服务，但磁盘 .output 已损坏。" >&2
      echo "[deploy] >>> 切勿手动 pm2 restart（会起不来）！<<<" >&2
      echo "[deploy] 恢复方式二选一：" >&2
      echo "[deploy]   a) 修复构建问题后重跑 bash scripts/deploy.sh（推荐）；" >&2
      echo "[deploy]   b) 应急还原上一版产物：mv .output.prev .output" >&2
      echo "[deploy]      （仅当本次部署 package-lock.json 未变更时可靠——产物不自包含，" >&2
      echo "[deploy]        运行时依赖 node_modules，lock 变了旧产物可能起不来）" >&2
      ;;
    迁移)
      echo "[deploy] 现场状态：数据库迁移失败，尚未构建/切换，pm2 旧进程仍在正常服务。" >&2
      echo "[deploy] 排查：核对 migrations 版本表与失败迁移文件，注意单文件多语句无事务包裹，" >&2
      echo "[deploy]       可能存在半执行状态；修复后可 npm run migrate 重跑（已执行版本自动跳过）。" >&2
      ;;
    重载与验活)
      echo "[deploy] 现场状态：新产物已构建并已尝试切换，服务可能未正常启动。" >&2
      echo "[deploy] 排查：pm2 logs 看启动报错；确认 .env / ecosystem.config.cjs / 数据库连通。" >&2
      echo "[deploy] 应急回滚（仅当本次 package-lock.json 未变更时可靠）：" >&2
      echo "[deploy]   rm -rf .output && mv .output.prev .output && pm2 startOrReload ecosystem.config.cjs --update-env" >&2
      ;;
    *)
      echo "[deploy] 现场状态：尚未进入安装/迁移/构建，线上进程与磁盘产物均未变更，可安心重试。" >&2
      ;;
  esac
  echo "${C_RED}=============================================================${C_RESET}" >&2
}
trap on_error ERR

# ============================================================================
# 一、preflight 检查（全部只读，失败即停）
# ============================================================================
CURRENT_STEP="preflight 检查"
info "===== 一、前置检查 ====="

# 1. node 存在性与版本（Nuxt 4 要求 ^22.19 || ^24.11 || >=26；.nvmrc 为单一事实源）
command -v node >/dev/null 2>&1 \
  || die "找不到 node。若用 nvm 管理，请先加载：export NVM_DIR=${NVM_DIR_DEFAULT} && . \"\$NVM_DIR/nvm.sh\" && nvm use"
NODE_MAJOR="$(node -v | sed 's/^v//' | cut -d. -f1)"
NVMRC_VERSION="$(tr -d '[:space:]' < .nvmrc)"
[ "$NODE_MAJOR" -ge 22 ] || die "node 主版本过低：$(node -v)（要求 >=22，.nvmrc 基准为 ${NVMRC_VERSION}）"
if [ "$NODE_MAJOR" != "$NVMRC_VERSION" ]; then
  warn "当前 node $(node -v) 与 .nvmrc/CI 基准（${NVMRC_VERSION}）不一致，建议另行安排对齐：nvm install ${NVMRC_VERSION}"
fi

# 1.5 步骤三的哈希对比依赖 sha256sum 与 awk（标配工具，裁剪系统可能缺失）
for tool in sha256sum awk; do
  command -v "$tool" >/dev/null 2>&1 \
    || die "找不到 ${tool}（步骤三依赖安装的哈希对比需要）。安装：yum install -y coreutils gawk"
done

# 2. npm registry 白名单（曾被误配成 npmmirror 二进制 CDN 导致全部包 404）
REGISTRY="$(npm config get registry)"
case "$REGISTRY" in
  https://registry.npmjs.org/* | https://registry.npmjs.org | https://registry.npmmirror.com/* | https://registry.npmmirror.com) ;;
  *)
    die "npm registry 异常：${REGISTRY}
  正确值应为官方源或 npmmirror 注册表，修复命令：
    npm config set registry https://registry.npmmirror.com
  （注意：cdn.npmmirror.com/binaries 与 npmmirror.com/mirrors/npm 是二进制镜像/遗留跳转，不是包注册表）"
    ;;
esac

# 3. package-lock.json 必须存在（禁止裸 npm i 重新生成）
[ -f package-lock.json ] \
  || die "package-lock.json 缺失。禁止裸 npm i 重新生成（依赖漂移 + npm 10.9.8 Arborist bug），
  请从 git 恢复：git checkout -- package-lock.json"

# 4. .env 存在且关键项非空（简查：取 KEY= 后的值并剥引号，不做完整解析）
[ -f .env ] || die ".env 不存在。请参照 .env.example 创建并填写。"
env_value() { grep -E "^$1=" .env | head -1 | cut -d= -f2- | tr -d '"'"'"' ' | tr -d '\r'; }
for key in NUXT_JWT_SECRET NUXT_DB_HOST NUXT_DB_PORT NUXT_DB_USER NUXT_DB_PASSWORD NUXT_DB_DATABASE; do
  [ -n "$(env_value "$key")" ] || die ".env 缺少必填项：${key}（参照 .env.example 填写）"
done
if [ -z "$(env_value NUXT_LOG_RETENTION_DAYS)" ]; then
  warn "NUXT_LOG_RETENTION_DAYS 未设置，文件日志保留天数将取默认 30；生产建议在 .env 显式设置。"
fi

# 5. pm2 与 ecosystem 配置
command -v pm2 >/dev/null 2>&1 || die "找不到 pm2。安装：npm i -g pm2"
[ -f ecosystem.config.cjs ] \
  || die "ecosystem.config.cjs 不存在（该文件不入库，属本机配置）。
  初始化：cp ecosystem.config.example.cjs ecosystem.config.cjs 后按本机情况编辑。"

# 6. 执行用户与仓库属主一致性（root 操作 web 属主仓库会造成 node_modules 属主漂移）
REPO_OWNER="$(stat -c '%U' . 2>/dev/null || echo 未知)"
if [ "$(whoami)" != "$REPO_OWNER" ]; then
  warn "当前用户 $(whoami) 与仓库属主 ${REPO_OWNER} 不一致，安装/构建产物属主会漂移。"
  warn "建议改用：sudo -u ${REPO_OWNER} bash scripts/deploy.sh；或部署后 chown -R ${REPO_OWNER}:${REPO_OWNER} node_modules .output"
  confirm "仍要以 $(whoami) 继续部署吗？"
fi

# 7. 展示现有 pm2 进程（不假设进程名；若存在历史手工启动的旧进程，
#    startOrReload 只管 ecosystem 里声明的应用，旧进程需人工 pm2 delete <名字>，本脚本不代劳）
info "当前 pm2 进程列表（如有与 ecosystem 不同名的旧进程，切换后请人工清理）："
pm2 list || true

# ============================================================================
# 二、变更预览与确认
# ============================================================================
CURRENT_STEP="变更预览"
info "===== 二、变更预览 ====="
git fetch
UPSTREAM="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)"
[ -n "$UPSTREAM" ] || die "当前分支未设置上游（@{u}），无法确定部署来源。请先 git branch --set-upstream-to=origin/<分支>"
BEHIND_COUNT="$(git rev-list --count "HEAD..${UPSTREAM}")"
if [ "$BEHIND_COUNT" -eq 0 ]; then
  info "已是最新（${UPSTREAM}），本次将按当前代码重新部署。"
else
  info "即将拉取 ${BEHIND_COUNT} 个新提交（${UPSTREAM}）："
  git log --oneline "HEAD..${UPSTREAM}"
  echo ""
  info "变更概览："
  git diff --stat "HEAD..${UPSTREAM}" | tail -20
  # 高亮新增迁移：有新迁移意味着本次部署包含数据库结构变更
  NEW_MIGRATIONS="$(git diff --name-only --diff-filter=A "HEAD..${UPSTREAM}" -- server/db/migrations/ || true)"
  if [ -n "$NEW_MIGRATIONS" ]; then
    warn "本次包含新数据库迁移（将在构建前自动执行）："
    echo "$NEW_MIGRATIONS"
  fi
fi
confirm "确认部署以上内容？"

CURRENT_STEP="拉取代码"
# --ff-only：本地有分叉/脏改动时直接失败，绝不自动 reset --hard 丢弃现场
git pull --ff-only \
  || die "git pull --ff-only 失败：本地与远端分叉或有未提交改动。
  请 git status 检查现场，人工处理（stash/提交/放弃）后重跑；本脚本不做自动覆盖。"

# ============================================================================
# 三、安装与迁移
# ============================================================================
CURRENT_STEP="安装依赖"
info "===== 三、安装依赖（lock 哈希跳过 / 增量安装 / npm ci 兜底） ====="
# 策略（省流量、降内存峰值、缩短部署时间）：
#   1) 上次安装成功后把「package-lock.json 的 sha256:Node 主版本」记录到
#      node_modules 内的状态文件（天然不入库；node_modules 被清空时状态自动失效）；
#   2) 本次两段均一致且 node_modules 完整（.bin/nuxt 与 nuxt 目录存在）→ 跳过安装；
#   3) lock 哈希变化，或 lock 未变但 Node 主版本变更（原生模块 ABI 需重装）、
#      或状态文件为旧格式（无 Node 版本段）→ npm install 按 lock 增量安装（非裸装，
#      lock 已在 preflight 确认存在）；峰值内存远低于 npm ci 的全量删装
#      （小内存机曾因 npm ci 被 OOM 杀）；
#   4) 无状态文件 / node_modules 不完整 / --clean → 全量 npm ci（原行为兜底）。
# 不加 --omit=dev：构建需要 devDependencies，且 migrate 依赖 devDeps 里的 tsx；
# postinstall 会自动执行 nuxt prepare
LOCK_HASH_FILE="node_modules/.deploy-lock-hash"
LOCK_HASH="$(sha256sum package-lock.json | awk '{print $1}')"
LOCK_STATE="${LOCK_HASH}:${NODE_MAJOR}"
if [ "$CLEAN_INSTALL" -eq 1 ]; then
  info "--clean：删除状态文件 ${LOCK_HASH_FILE}，强制全量 npm ci"
  rm -f "$LOCK_HASH_FILE"
fi
INSTALL_MODE="ci"
if [ ! -e node_modules/.bin/nuxt ] || [ ! -d node_modules/nuxt ]; then
  info "node_modules 缺失或不完整（.bin/nuxt 或 nuxt 目录不存在），执行全量 npm ci"
elif [ -f "$LOCK_HASH_FILE" ] && [ "$(cat "$LOCK_HASH_FILE")" = "$LOCK_STATE" ]; then
  info "package-lock.json 未变化（sha256 一致）、Node 主版本一致（${NODE_MAJOR}）且 node_modules 完整，跳过依赖安装"
  INSTALL_MODE="skip"
elif [ -f "$LOCK_HASH_FILE" ]; then
  PREV_STATE="$(cat "$LOCK_HASH_FILE")"
  case "$PREV_STATE" in
    *:*) PREV_NODE="${PREV_STATE##*:}" ;;
    *)   PREV_NODE="未知（旧格式状态文件，无 Node 版本段）" ;;
  esac
  if [ "${PREV_STATE%%:*}" = "$LOCK_HASH" ]; then
    info "package-lock.json 未变化，但 Node 主版本不匹配（记录：${PREV_NODE} → 当前：${NODE_MAJOR}），需重装以匹配原生模块 ABI，按 lock 增量安装（npm install）"
  else
    info "package-lock.json 已变化，按 lock 增量安装（npm install）"
  fi
  INSTALL_MODE="install"
else
  info "无安装状态文件（首次运行或上次安装未成功），执行全量 npm ci"
fi
if [ "$INSTALL_MODE" != "skip" ]; then
  if [ "$INSTALL_MODE" = "install" ]; then
    npm install --no-audit --no-fund
  else
    npm ci --no-audit --no-fund
  fi
  # 安装成功才落状态；重新计算哈希（npm install 极端情况下可能同步 lock）
  printf '%s:%s\n' "$(sha256sum package-lock.json | awk '{print $1}')" "$NODE_MAJOR" > "$LOCK_HASH_FILE"
fi

CURRENT_STEP="迁移"
info "===== 四、数据库迁移（先迁移后上流量，硬约束） ====="
# 新代码可能依赖新列（如迁移 023 的 request_id/error_message/error_stack），
# 未迁移就切流量会导致埋点 INSERT 静默失败；migrate.ts 失败会 exit 1 被 set -e 截停
npm run migrate

# ============================================================================
# 四、构建（build 前备份上一版产物，供应急回滚）
# ============================================================================
CURRENT_STEP="构建"
info "===== 五、构建 ====="
rm -rf .output.prev
if [ -d .output ]; then
  mv .output .output.prev
  info "已备份上一版产物到 .output.prev（应急回滚用，下次部署自动清理）"
fi
npm run build

# ============================================================================
# 五、重载与验活
# ============================================================================
CURRENT_STEP="重载与验活"
info "===== 六、切换新版本（pm2 startOrReload） ====="
# startOrReload 幂等：进程不存在则 start，存在则 reload；
# --update-env 强制重读 ecosystem 的 env（pm2 reload 默认复用内存中旧定义，不会自动重读配置文件）
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save

# 健康检查：端口从 ecosystem.config.cjs 读取（单一事实源），读不到则回退 ${DEFAULT_APP_PORT}
APP_PORT="$(node -e "const c=require('./ecosystem.config.cjs');console.log((c.apps&&c.apps[0]&&c.apps[0].env&&c.apps[0].env.PORT)||${DEFAULT_APP_PORT})" 2>/dev/null || echo "${DEFAULT_APP_PORT}")"
info "健康检查：http://127.0.0.1:${APP_PORT}/（最多重试 6 次，每次间隔 5s）"
HEALTH_OK=0
for i in 1 2 3 4 5 6; do
  if curl -fsS -m 5 "http://127.0.0.1:${APP_PORT}/" >/dev/null 2>&1; then
    HEALTH_OK=1
    break
  fi
  info "第 ${i}/6 次未通过，5s 后重试……"
  sleep 5
done
if [ "$HEALTH_OK" -ne 1 ]; then
  # 走统一失败出口（触发 trap 打印本步骤的排查与回滚指引）
  false
fi

# ----- 成功摘要 -----
echo ""
info "============================================================="
info "部署成功 ✔"
info "  commit : $(git rev-parse --short HEAD)  ($(git log -1 --format=%s))"
info "  node   : $(node -v)"
info "  端口   : ${APP_PORT}"
info "  时间   : $(date '+%Y-%m-%d %H:%M:%S')"
info "  后续   : pm2 logs 观察启动日志；上一版产物在 .output.prev（下次部署自动清理）"
info "============================================================="
