// Channel names only (no runtime dependencies) so the sandboxed preload can import them.

export const INVOKE_CHANNELS = [
  'app:info',
  'settings:get',
  'settings:update',
  'settings:requestDeveloperMode',
  'settings:setSimulationOnly',
  'project:sample',
  'project:normalize',
  'project:open',
  'project:save',
  'import:svg',
  'import:image',
  'text:toPath',
  'geometry:cylinderMesh',
  'toolpath:plan',
  'toolpath:preview',
  'gcode:analyze',
  'gcode:export',
  'machine:create',
  'machine:setProject',
  'machine:command',
  'machine:inject',
  'machine:timeline',
  'machine:log',
  'machine:jobLog',
  'machine:safetyHistory',
  'machine:programListing',
  'machine:setSpeed',
  'device:discover',
  'device:identify',
  'cad:importDialog',
  'cad:importBytes',
  'cad:cancel',
  'cad:confirmUnits',
  'cad:measure',
  'cad:release',
  'cad:restore',
  'cad:alignToRotary',
  'cad:section',
  'cad:exportReport',
] as const;

export type InvokeChannel = (typeof INVOKE_CHANNELS)[number];

export const EVENT_CHANNELS = ['machine:snapshot', 'app:log', 'cad:progress'] as const;

export type EventChannel = (typeof EVENT_CHANNELS)[number];

export function isInvokeChannel(c: string): c is InvokeChannel {
  return (INVOKE_CHANNELS as readonly string[]).includes(c);
}

export function isEventChannel(c: string): c is EventChannel {
  return (EVENT_CHANNELS as readonly string[]).includes(c);
}
