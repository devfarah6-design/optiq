import React, { createContext, useContext, useState, useCallback } from 'react'

interface MobileNavCtx {
  isOpen: boolean
  toggle: () => void
  close: () => void
}

const MobileNavContext = createContext<MobileNavCtx>({
  isOpen: false,
  toggle: () => {},
  close: () => {},
})

export function MobileNavProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const toggle = useCallback(() => setIsOpen(v => !v), [])
  const close  = useCallback(() => setIsOpen(false), [])
  return (
    <MobileNavContext.Provider value={{ isOpen, toggle, close }}>
      {children}
    </MobileNavContext.Provider>
  )
}

export function useMobileNav() {
  return useContext(MobileNavContext)
}
