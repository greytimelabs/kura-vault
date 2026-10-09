import { createContext, useContext } from 'react';

/** The shell's scrolling element, which virtualised grids measure against. */
export const ScrollContext = createContext<HTMLElement | null>(null);

export const useScrollElement = () => useContext(ScrollContext);
