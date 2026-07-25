// app/composables/useJsonLd.ts
// JSON-LD 结构化数据注入（SEO 锦上添花）
//
// 约束：schema 内容只能用 SSR/CSR 一致的静态值（禁止 Date/user 等运行时差异值），
// head script 不参与组件树水合，不会产生 hydration mismatch。
import { SITE_NAME, SITE_DESCRIPTION } from '~/utils/seo'

/** 注入一段 application/ld+json 到页面 head */
export function useJsonLd(schema: Record<string, unknown>): void {
  useHead({
    script: [
      {
        type: 'application/ld+json',
        innerHTML: JSON.stringify(schema),
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
