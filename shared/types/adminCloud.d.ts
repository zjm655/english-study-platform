/** 云服务管理模块共享类型 */

/** 估算查询参数 */
export interface CloudEstimateQuery {
  days?: number // 1-90，默认 7
}

/** 单路径估算明细 */
export interface CloudPathEstimate {
  path: string
  /** 展示名（如「录音上传 (PUT)」），未设则回退 path */
  label?: string
  method: string
  count: number
  unitPrice: number
  estimatedCost: number
  /** 业务时长（毫秒，仅按时长计费的产品如 NLS 有值：真实音频时长 biz_duration_ms 之和） */
  bizDurationMs?: number
}

/** 本地埋点估算汇总 */
export interface CloudEstimateSummary {
  totalCalls: number
  totalEstimatedCost: number
  unitPrice: number
  unit: string // '次' | '小时' 等
  byPath: CloudPathEstimate[]
  days: number
  /** 总业务时长（毫秒，仅按时长计费的产品如 NLS 有值：SUM(biz_duration_ms)） */
  bizDurationMs?: number
}

/** OSS Bucket 统计（官方 GetBucketStat API，数据延迟可能 >1h，不含流量） */
export interface OssBucketStat {
  success: boolean
  storage?: number // 总存储字节
  objectCount?: number // Object 数量
  standardStorage?: number // 标准存储字节
  standardObjectCount?: number
  multipartUploadCount?: number
  lastModifiedTime?: number // 秒级时间戳（数据非实时）
  infrequentAccessStorage?: number
  infrequentAccessObjectCount?: number
  archiveStorage?: number
  archiveObjectCount?: number
  coldArchiveStorage?: number
  coldArchiveObjectCount?: number
  deepColdArchiveStorage?: number
  deepColdArchiveObjectCount?: number
  error?: string
}

/** OSS 页面完整响应 */
export interface OssStatResult {
  estimate: CloudEstimateSummary
  bucketStat: OssBucketStat
}

/** NLS 页面响应 */
export interface NlsStatResult {
  estimate: CloudEstimateSummary
}

/** 智能科教页面响应 */
export interface EduStatResult {
  estimate: CloudEstimateSummary
}

/** BSS 账单项 */
export interface BssBillItem {
  productCode: string
  productName: string
  subscriptionType: string
  pretaxAmount: number
  deductedByCoupons: number
  paymentAmount: number
}

/** BSS 账单查询结果 */
export interface BssBillResult {
  success: boolean
  billingCycle?: string
  totalCount?: number
  items?: BssBillItem[]
  error?: string
}

/** BSS 账单总览项（按产品汇总） */
export interface BssBillOverviewItem {
  productCode: string
  productName: string
  pretaxAmount: number
  deductedByCoupons: number
  paymentAmount: number
}

/** BSS 账单总览结果 */
export interface BssBillOverviewResult {
  success: boolean
  billingCycle?: string
  items?: BssBillOverviewItem[]
  error?: string
}

/** BSS 代金券 */
export interface BssCashCoupon {
  cashCouponId: string
  nominalValue: string
  balance: string
  expiryTime: string
  status: string
  applicableProducts: string
}

/** BSS 代金券查询结果 */
export interface BssCashCouponsResult {
  success: boolean
  items?: BssCashCoupon[]
  error?: string
}

/** BSS 预付卡 */
export interface BssPrepaidCard {
  prepaidCardId: string
  nominalValue: string
  balance: string
  expiryTime: string
  applicableProducts: string
}

/** BSS 预付卡查询结果 */
export interface BssPrepaidCardsResult {
  success: boolean
  items?: BssPrepaidCard[]
  error?: string
}

/** BSS 月度消费趋势点 */
export interface BssMonthlyTrendPoint {
  billingCycle: string
  pretaxAmount: number
  paymentAmount: number
}

/** BSS 月度消费趋势结果 */
export interface BssMonthlyTrendResult {
  success: boolean
  items?: BssMonthlyTrendPoint[]
  error?: string
}

/** BSS 页面完整响应 */
export interface BssStatResult {
  balance: import('./adminStats').CloudBalanceResult
  bill: BssBillResult
  billOverview: BssBillOverviewResult
  coupons: BssCashCouponsResult
  prepaidCards: BssPrepaidCardsResult
  monthlyTrend: BssMonthlyTrendResult
}

// ==================== DeepSeek 余额 ====================

/** DeepSeek 余额条目 */
export interface DeepSeekBalanceInfo {
  currency: string // 'CNY' | 'USD'
  totalBalance: string // 总可用余额（含赠金+充值）
  grantedBalance: string // 未过期赠金
  toppedUpBalance: string // 充值余额
}

/** DeepSeek 余额查询结果 */
export interface DeepSeekBalanceResult {
  success: boolean
  isAvailable?: boolean
  balances?: DeepSeekBalanceInfo[]
  error?: string
}

/** DeepSeek 页面完整响应 */
export interface DeepSeekStatResult {
  balance: DeepSeekBalanceResult
}

// ==================== 云服务趋势 ====================

/** 趋势查询参数 */
export interface CloudTrendQuery {
  service: 'oss' | 'nls' | 'deepseek' | 'edu'
  days?: number
}

/** 趋势数据 */
export interface CloudTrendResult {
  service: string
  days: number
  dates: string[]
  callCounts: number[]
  totalDurations: number[]
  totalTokens: number[]
}
