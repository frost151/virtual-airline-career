const regionNames = new Intl.DisplayNames(['ru'], { type: 'region' })

export function countryName(iso: string): string {
  try {
    return regionNames.of(iso) ?? iso
  } catch {
    return iso
  }
}
