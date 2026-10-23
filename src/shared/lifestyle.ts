/** Личная жизнь пилота: каталоги, имущество, кредиты, инвестиции. */

export interface CountryParams {
  col: number
  housing: number
  tax: number
  mortgage: number
  carImport: number
}

export type CarClass = 'economy' | 'compact' | 'midsize' | 'suv' | 'offroad' | 'premium' | 'luxury' | 'sport' | 'super' | 'hyper'

export interface CarModel {
  id: string
  brand: string
  model: string
  class: CarClass
  origin: string
  price: number
  electric?: boolean
  /** Статья английской Википедии — оттуда берём фото. */
  wiki?: string
}

export interface HousingOption {
  id: string
  name: string
  rooms: number
  rent: number
  /** 0 — купить нельзя (комната). */
  price: number
  recovery: number
  comfort: number
  prestige: number
}

export interface GaAircraft {
  id: string
  name: string
  price: number
  monthly: number
  prestige: number
  comfort: number
  /** Подстроки названия в MSFS, по которым узнаём свой самолёт. */
  match: string[]
  burnKgH: number
}

export interface RestOption {
  id: string
  name: string
  price: number
  fatigue: number
  satisfaction: number
  health: number
  /** Цена растёт с размером семьи (поездки). */
  family: boolean
}

export interface SubscriptionOption {
  id: string
  name: string
  monthly: number
  health: number
  fatigueDaily: number
  satisfaction: number
  prestige: number
}

export interface Course {
  id: string
  name: string
  price: number
  requires: string | null
  effect: string
}

export interface Collectible {
  id: string
  name: string
  price: number
  prestige: number
  /** Годовой рост стоимости. */
  growth: number
}

export type AssetKind = 'home' | 'car' | 'aircraft' | 'collectible'

export interface Asset {
  id: number
  kind: AssetKind
  itemId: string
  name: string
  ownership: 'own' | 'rent'
  country: string
  airport: string | null
  value: number
  purchasePrice: number
  /** Основное жильё (где живёт пилот). */
  residence: boolean
  rentedOut: boolean
  boughtAt: number
  /** Ежемесячные расходы (аренда/содержание) по текущим ценам. */
  monthly: number
  prestige: number
  loanId: number | null
}

export type LoanKind = 'mortgage' | 'auto' | 'aircraft'

export interface Loan {
  id: number
  kind: LoanKind
  assetId: number | null
  assetName: string | null
  principal: number
  balance: number
  /** Годовая ставка, %. */
  rate: number
  payment: number
  monthsLeft: number
  overdue: number
}

export type InvestmentKind = 'deposit' | 'bonds' | 'index' | 'shares'

export interface Investment {
  id: number
  kind: InvestmentKind
  principal: number
  value: number
  rate: number
  openedAt: number
  /** Для акций: авиакомпания и количество бумаг. */
  icao: string | null
  quantity: number | null
}

export interface Family {
  partner: boolean
  children: number
}

export interface BudgetLine {
  label: string
  amount: number
}

export interface LifeState {
  fatigue: number
  health: number
  satisfaction: number
  prestige: number
  medicalUntil: number
  family: Family
  country: string | null
  params: CountryParams
  priceLevel: number
  /** Ежемесячный бюджет: расходы (отрицательные) и доходы. */
  budget: BudgetLine[]
  assets: Asset[]
  loans: Loan[]
  investments: Investment[]
  subscriptions: string[]
  education: string[]
  /** Можно ли сейчас брать рейсы. */
  fitToFly: { ok: boolean; reason: string | null }
  /** Сколько комнат нужно семье. */
  roomsNeeded: number
}

/** Каталог с ценами под страну базы и текущую инфляцию. */
export interface PricedCatalog {
  country: string | null
  cars: (CarModel & { localPrice: number; monthly: number; prestige: number; imported: boolean })[]
  housing: (HousingOption & { localRent: number; localPrice: number })[]
  aircraft: (GaAircraft & { localPrice: number; localMonthly: number })[]
  rest: (RestOption & { localPrice: number })[]
  subscriptions: (SubscriptionOption & { localMonthly: number })[]
  education: (Course & { localPrice: number })[]
  collectibles: (Collectible & { localPrice: number })[]
  rates: { mortgage: number; auto: number; aircraft: number; deposit: number; bonds: number }
  medicalCost: number
}

export const CAR_CLASS_LABEL: Record<CarClass, string> = {
  economy: 'Бюджетный',
  compact: 'Компактный',
  midsize: 'Средний',
  suv: 'Кроссовер',
  offroad: 'Внедорожник',
  premium: 'Премиум',
  luxury: 'Люкс',
  sport: 'Спортивный',
  super: 'Суперкар',
  hyper: 'Гиперкар'
}

export const INVESTMENT_LABEL: Record<InvestmentKind, string> = {
  deposit: 'Банковский вклад',
  bonds: 'Облигации',
  index: 'Индексный фонд акций',
  shares: 'Акции авиакомпании'
}

export const LOAN_LABEL: Record<LoanKind, string> = {
  mortgage: 'Ипотека',
  auto: 'Автокредит',
  aircraft: 'Кредит на самолёт'
}

/** Порог усталости, после которого рейсы недоступны. */
export const FATIGUE_LIMIT = 85
