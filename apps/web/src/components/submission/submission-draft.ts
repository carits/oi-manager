type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function transitionSubmissionDraft(storage: DraftStorage, previousKey: string | null, nextKey: string, currentValue: string) {
  if (previousKey === nextKey) return currentValue
  if (previousKey) {
    if (currentValue) storage.setItem(previousKey, currentValue)
    else storage.removeItem(previousKey)
  }
  const saved = storage.getItem(nextKey)
  if (previousKey === null && currentValue) return currentValue
  return saved ?? ''
}
