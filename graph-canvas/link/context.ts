"use client";
import { createContext, useContext, createElement } from "react";
import type { ReactNode } from "react";
import { useStore } from "zustand";
import type { GraphLink, GraphLinkState } from "./GraphLink.js";

export const GraphLinkContext = createContext<GraphLink | null>(null);

/** Provide a GraphLink to every <GraphCanvas> rendered inside. */
export function GraphLinkProvider({
  link,
  children,
}: {
  link: GraphLink;
  children: ReactNode;
}) {
  return createElement(GraphLinkContext.Provider, { value: link }, children);
}

/** Read the nearest GraphLink from context, or null if there is none. */
export function useGraphLink(): GraphLink | null {
  return useContext(GraphLinkContext);
}

/** Subscribe to a slice of a GraphLink's shared state. */
export function useGraphLinkState<U>(
  link: GraphLink,
  selector: (state: GraphLinkState) => U
): U {
  return useStore(link.store, selector);
}
