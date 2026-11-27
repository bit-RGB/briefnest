// Explicit fixture adapters, NOT the Hermes SDK or live host.
import React, { useSyncExternalStore } from 'react'
export { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
let profile = 'fixture-a', epoch = 1
const listeners = new Set()
export const gatewayActivationEpoch = () => epoch
export const host = { state: { profile: { get: () => profile }, connectionId: { get: () => null } }, profileRoutes: async () => [{profile, connectionId:'fixture-local',targetProfile:profile}], notify: message => window.fixtureNotifications.push(message) }
export function setFixtureScope(next, nextEpoch = epoch) { profile = next; epoch = nextEpoch; for (const fn of listeners) fn() }
export function useValue(store) { const snapshot=useSyncExternalStore(fn => { listeners.add(fn); return () => listeners.delete(fn) }, () => `${profile}:${epoch}`); return store===host.state.profile ? snapshot.split(':')[0] : store.get() }
export const Button = React.forwardRef(({variant, size, ...props}, ref) => React.createElement('button', {...props, ref}))
export const Codicon = () => null
export const Dialog = ({open,children}) => open ? React.createElement('section',{role:'dialog'},children) : null
export const DialogContent = ({onCloseAutoFocus,...props}) => React.createElement('div',props)
export const DialogDescription = props => React.createElement('p',props)
export const DialogFooter = props => React.createElement('div',props)
export const DialogHeader = DialogFooter
export const DialogTitle = props => React.createElement('h2',props)
export const EmptyState = () => null
export const ErrorState = () => null
export const Input = props => React.createElement('input',props)
export const SandboxedFrame = () => React.createElement('div',{'data-fixture-sandbox':true})
export const ScrollArea = props => React.createElement('div',props)
export const Skeleton = ScrollArea
export const Switch = () => null
export const ROUTES_AREA = 'fixture-routes', SIDEBAR_NAV_AREA = 'fixture-nav'
