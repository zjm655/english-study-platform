import { request } from '~/utils/request'
import { userFavWordsPath, userFavWordPath } from '../paths'

/** 获取当前用户收藏的单词 ID 列表 */
export const getFavWordIds = async () => {
  return request<number[]>(userFavWordsPath, { method: 'GET' })
}

/** 收藏/取消收藏单词（toggle） */
export const toggleFavWord = async (vocabularyId: number) => {
  return request<{ isFav: boolean }>(userFavWordPath, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { vocabularyId },
  })
}

/** 检查单个单词是否已收藏 */
export const checkWordFavStatus = async (vocabularyId: number) => {
  return request<{ isFav: boolean }>(`${userFavWordPath}/${vocabularyId}/status`, {
    method: 'GET',
  })
}