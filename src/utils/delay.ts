export function delay(forMs: number): Promise<void> {
  return new Promise((res, rej) => {
    setTimeout(res, forMs)
  })
}
