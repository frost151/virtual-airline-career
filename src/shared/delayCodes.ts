/**
 * Причины задержек по мотивам кодов IATA (AHM 730) + собственный код для сбоя симулятора.
 *
 * responsibility определяет последствия:
 *  - airline  — вина авиакомпании: штраф к репутации, компенсации пассажирам (как EC 261);
 *  - external — внешние причины (погода, УВД, аэропорт): репутация почти не страдает;
 *  - sim      — сбой симулятора: без штрафа пилоту, но рейс задержан со всеми расходами.
 */
export type DelayResponsibility = 'airline' | 'external' | 'sim'

export interface DelayCode {
  code: string
  group: string
  title: string
  responsibility: DelayResponsibility
}

export const DELAY_CODES: DelayCode[] = [
  { code: '11', group: 'Пассажиры и багаж', title: 'Поздняя регистрация пассажиров', responsibility: 'airline' },
  { code: '15', group: 'Пассажиры и багаж', title: 'Посадка пассажиров: опоздавшие, поиск пассажиров', responsibility: 'airline' },
  { code: '18', group: 'Пассажиры и багаж', title: 'Обработка багажа', responsibility: 'airline' },
  { code: '21', group: 'Груз и почта', title: 'Оформление и загрузка груза', responsibility: 'airline' },
  { code: '31', group: 'Наземное обслуживание', title: 'Документация, загрузочная ведомость', responsibility: 'airline' },
  { code: '33', group: 'Наземное обслуживание', title: 'Оборудование: трап, буксир, GPU', responsibility: 'external' },
  { code: '34', group: 'Наземное обслуживание', title: 'Обслуживание ВС: уборка, вода, санузлы', responsibility: 'airline' },
  { code: '36', group: 'Наземное обслуживание', title: 'Заправка топливом', responsibility: 'external' },
  { code: '37', group: 'Наземное обслуживание', title: 'Бортпитание', responsibility: 'airline' },
  { code: '41', group: 'Техника', title: 'Неисправность воздушного судна', responsibility: 'airline' },
  { code: '43', group: 'Техника', title: 'Внеплановое техобслуживание', responsibility: 'airline' },
  { code: '51', group: 'Повреждения и ИТ', title: 'Повреждение ВС на земле', responsibility: 'airline' },
  { code: '55', group: 'Повреждения и ИТ', title: 'Сбой систем вылета / регистрации', responsibility: 'airline' },
  { code: '61', group: 'Лётные операции и экипаж', title: 'Подготовка документации полёта (OFP)', responsibility: 'airline' },
  { code: '63', group: 'Лётные операции и экипаж', title: 'Поздняя явка экипажа', responsibility: 'airline' },
  { code: '64', group: 'Лётные операции и экипаж', title: 'Нехватка экипажа', responsibility: 'airline' },
  { code: '71', group: 'Погода', title: 'Погода в аэропорту вылета', responsibility: 'external' },
  { code: '72', group: 'Погода', title: 'Погода в аэропорту назначения', responsibility: 'external' },
  { code: '75', group: 'Погода', title: 'Противообледенительная обработка', responsibility: 'external' },
  { code: '81', group: 'УВД и аэропорт', title: 'Ограничения УВД на маршруте (слот)', responsibility: 'external' },
  { code: '83', group: 'УВД и аэропорт', title: 'Ограничения в аэропорту назначения', responsibility: 'external' },
  { code: '87', group: 'УВД и аэропорт', title: 'Инфраструктура аэропорта: стоянки, ВПП', responsibility: 'external' },
  { code: '89', group: 'УВД и аэропорт', title: 'Ограничения в аэропорту вылета, ожидание буксировки', responsibility: 'external' },
  { code: '93', group: 'Реакционные', title: 'Позднее прибытие ВС с предыдущего рейса', responsibility: 'airline' },
  { code: '99', group: 'Прочее', title: 'Иная причина', responsibility: 'airline' },
  { code: 'SC', group: 'Симулятор', title: 'Сбой / вылет симулятора', responsibility: 'sim' }
]
