export const bytes = (value: number): string => {
  const unit = value < 1000 ? 0 : Math.min(3, Math.floor(Math.log10(value) / 3))
  return `${(value / 1000 ** unit).toFixed(unit ? 1 : 0)} ${['B', 'KB', 'MB', 'GB'][unit]}`
}
