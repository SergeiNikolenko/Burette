import { createContext, useContext } from 'react'
import { molecularRu } from '../lib/molecular-ru'

export const MolecularLocale = createContext('en')
export function useLocale() {
  const locale = useContext(MolecularLocale)
  return { locale, t: <T,>(value: T): T => (typeof value === 'string' && locale === 'ru'
    ? (molecularRu as Record<string, string>)[value] ?? value : value) as T }
}
