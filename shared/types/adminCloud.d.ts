/** 云服务管理模块共享类型 */

/** 估算查询参数 */
export interface CloudEstimateQuery {
  days?: number  // 1-90，默认 7
}

/** 单路径估算明细 */
export interface CloudPathEstimate {
  path: string
  method: string
  count: number
  unitPrice: number
  estimatedCost: number
}

/** 本地埋点估算汇总 */
export interface CloudEstimateSummary {
  totalCalls: number
  totalEstimatedCost: number
  unitPrice: number
  unit: string           // '次' | '小时' 等
  byPath: CloudPathEstimate[]
  days: number
}

/** OSS Bucket 统计（官方 API） */
export interface OssBucketStat {
  success: boolean
  storage?: number          // 总存储字节
  objectCount?: number      // Object 数量
  standardStorage?: number  // 标准存储字节
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

/** BSS 页面完整响应 */
export interface BssStatResult {
  balance: import('./adminStats').CloudBalanceResult
  bill: BssBillResult
}
