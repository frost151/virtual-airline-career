import { Table, UnstyledButton, Group, Text } from '@mantine/core'

export type SortDir = 'asc' | 'desc'
export interface SortState<K extends string> {
  key: K
  dir: SortDir
}

interface Props<K extends string> {
  sortKey: K
  sort: SortState<K>
  onSort(next: SortState<K>): void
  /** Направление при первом клике: числа обычно удобнее смотреть по убыванию. */
  firstDir?: SortDir
  align?: 'left' | 'right'
  children: React.ReactNode
}

/** Заголовок колонки с сортировкой по клику; повторный клик меняет направление. */
export function SortableTh<K extends string>({ sortKey, sort, onSort, firstDir = 'asc', align = 'left', children }: Props<K>) {
  const active = sort.key === sortKey
  const toggle = () =>
    onSort({ key: sortKey, dir: active ? (sort.dir === 'asc' ? 'desc' : 'asc') : firstDir })
  return (
    <Table.Th ta={align}>
      <UnstyledButton onClick={toggle} w="100%">
        <Group gap={4} justify={align === 'right' ? 'flex-end' : 'flex-start'} wrap="nowrap">
          <Text fw={700} size="sm">
            {children}
          </Text>
          <Text size="xs" c={active ? undefined : 'dimmed'} w={10}>
            {active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}
          </Text>
        </Group>
      </UnstyledButton>
    </Table.Th>
  )
}

/** Сравнение для Array.sort с учётом направления; строки — по-русски. */
export function compareBy<T>(get: (x: T) => string | number, dir: SortDir) {
  const sign = dir === 'asc' ? 1 : -1
  return (a: T, b: T) => {
    const va = get(a)
    const vb = get(b)
    const r = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'ru')
    return r * sign
  }
}
