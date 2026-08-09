<script setup lang="ts">
import { useSegmentDetail } from '~/composables/unit'
import type { SegmentDetail } from '#shared/types/unit'

definePageMeta({
  title: '我的单词',
})

const route = useRoute()
const segId = computed(() => Number(route.params.segId))

const { execute: fetchSegmentDetail } = useSegmentDetail()
const { fetchFavWords, favWordIds, toggleWord, togglingWord } = useFavorites()

const detail = ref<SegmentDetail | null>(null)
const isLoading = ref(false)
const loadError = ref('')

// 会话级缓存：同一材料详情只拉取一次（组件实例生命周期内）
const detailCache = new Map<number, SegmentDetail>()

// 该材料下已收藏的单词（响应式过滤：取消收藏后实时消失）
const favVocabList = computed(() => {
  if (!detail.value) return []
  return (detail.value.vocabulary || []).filter((v) => favWordIds.value.has(v.id))
})

onMounted(async () => {
  isLoading.value = true
  // 拉取收藏列表（懒实体化游客身份）
  await fetchFavWords()
  try {
    const cached = detailCache.get(segId.value)
    if (cached) {
      detail.value = cached
    } else {
      const res = await fetchSegmentDetail(segId.value)
      if (res?.code === 200 && res.data) {
        detailCache.set(segId.value, res.data)
        detail.value = res.data
      } else {
        loadError.value = res?.message || '加载失败'
      }
    }
  } catch {
    loadError.value = '网络异常，加载失败'
  } finally {
    isLoading.value = false
  }
})
</script>

<template>
  <div class="words-page">
    <!-- Loading -->
    <div v-if="isLoading" class="page-state">
      <DotPulse />
    </div>

    <!-- Error -->
    <div v-else-if="loadError" class="page-state page-state--error">
      <p>{{ loadError }}</p>
      <NuxtLink :to="`/learn/unit/${route.params.id}`" class="back-link">返回单元</NuxtLink>
    </div>

    <!-- Content -->
    <template v-else-if="detail">
      <!-- 面包屑：所属材料 -->
      <nav class="breadcrumb" aria-label="面包屑导航">
        <NuxtLink :to="`/learn/unit/${route.params.id}`" class="breadcrumb__link">
          {{ detail.unitTitle }}
        </NuxtLink>
        <span class="breadcrumb__separator" aria-hidden="true">/</span>
        <span class="breadcrumb__current" aria-current="page">{{ detail.title }}</span>
      </nav>

      <!-- 计数 -->
      <div class="words-count">本材料收藏 {{ favVocabList.length }} 个单词</div>

      <!-- Empty -->
      <div v-if="favVocabList.length === 0" class="page-state">
        <p>该材料下暂无收藏单词</p>
        <p class="page-state__sub">在学习页点击原文中的单词即可收藏</p>
      </div>

      <!-- 列表 -->
      <div v-else class="words-list">
        <WordCard
          v-for="vocab in favVocabList"
          :key="vocab.id"
          :vocab="vocab"
          :fav-active="true"
          :fav-disabled="togglingWord === vocab.id"
          @toggle-fav="toggleWord(vocab.id)"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.words-page {
  padding: 16px;
  min-height: 100%;
}

.breadcrumb {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  margin-bottom: 12px;
}

.breadcrumb__link {
  color: var(--primary);
  text-decoration: none;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.breadcrumb__separator {
  color: var(--text-3);
}

.breadcrumb__current {
  color: var(--text-2);
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.words-count {
  font-size: 13px;
  color: var(--text-3);
  margin-bottom: 12px;
}

.words-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.page-state {
  padding: 48px 16px;
  text-align: center;
  color: var(--text-3);
  font-size: 14px;
}

.page-state--error {
  color: var(--danger);
}

.page-state__sub {
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-3);
}

.back-link {
  display: inline-block;
  margin-top: 12px;
  color: var(--primary);
  text-decoration: none;
  font-size: 13px;
}
</style>
