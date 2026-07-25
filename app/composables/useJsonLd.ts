// app/composables/useJsonLd.ts
// JSON-LD 结构化数据注入（SEO 锦上添花）
//
// 约束：schema 内容只能用 SSR/CSR 一致的值——静态文案或 SSR payload 数据（如
// useAsyncRes 直出的单元名）均可；禁止 Date/浏览器本地时间等运行时差异值。
// head script 不参与组件树水合，不会产生 hydration mismatch。
import { SITE_NAME, SITE_DESCRIPTION } from '~/utils/seo'

/** 注入一段 application/ld+json 到页面 head（支持 getter，数据晚到时响应式更新） */
export function useJsonLd(schema: Record<string, unknown> | (() => Record<string, unknown>)): void {
  useHead({
    script: [
      {
        type: 'application/ld+json',
        innerHTML: () => JSON.stringify(toValue(schema)),
      },
    ],
  })
}

/** 首页用：教育组织 + 站点信息 */
export function educationalOrgSchema(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'EducationalOrganization',
    name: SITE_NAME,
    description: SITE_DESCRIPTION,
  }
}

/** 单元/材料页用：学习资源 */
export function learningResourceSchema(opts: {
  name: string
  description: string
}): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'LearningResource',
    name: opts.name,
    description: opts.description,
    inLanguage: 'en',
    learningResourceType: '听说训练材料',
    provider: {
      '@type': 'EducationalOrganization',
      name: SITE_NAME,
    },
  }
}
