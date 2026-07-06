import type { ReactNode } from 'react'

interface TabItem {
  id: string
  label: string
}

interface TabsProps {
  active: string
  items: TabItem[]
  onChange: (id: string) => void
}

export function Tabs({ active, items, onChange }: TabsProps) {
  return (
    <div className="inline-flex rounded-full bg-orange-100 p-1">
      {items.map(item => (
        <button
          className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
            active === item.id ? 'bg-white text-orange-800 shadow-sm' : 'text-stone-700'
          }`}
          key={item.id}
          onClick={() => onChange(item.id)}
          type="button"
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

export function TabPanel({ active, children, id }: TabPanelProps) {
  return <div className={active === id ? undefined : 'hidden'}>{children}</div>
}

interface TabPanelProps {
  active: string
  children: ReactNode
  id: string
}
