import type { DiscoveredDevice, FirmwareFamily } from '@ols/shared-types';
import { Badge, Button, Dialog, Input, Tabs, TabsContent, TabsList, TabsTrigger } from '@ols/ui';
import { Loader2, Radar, RefreshCw, Usb, Wifi } from 'lucide-react';

import { connectionLabel, useDevices } from '@/stores/devices';
import { useProject } from '@/stores/project';
import { useSettings } from '@/stores/settings';
import { useView } from '@/stores/view';

function familyBadge(family: FirmwareFamily) {
  if (family === 'v1') return <Badge tone="ok">V1 supported</Badge>;
  if (family === 'v2') return <Badge tone="warn">V2 not yet supported</Badge>;
  return <Badge tone="muted">Unknown firmware</Badge>;
}

function DeviceRow({
  device,
  activeHost,
  onSelect,
}: {
  device: DiscoveredDevice;
  activeHost: string;
  onSelect: (d: DiscoveredDevice) => void;
}) {
  const title = device.name || device.model || device.host;
  const meta = [device.model, device.firmware, device.serial].filter(Boolean).join(' · ');
  const selected = device.host === activeHost;
  return (
    <div
      className="flex items-start gap-2 rounded-md border border-border bg-card/40 px-2.5 py-2"
      data-testid={`device-row-${device.host}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium">
          <span className="truncate">{title}</span>
          {familyBadge(device.family)}
          {selected && <Badge tone="ok">current</Badge>}
        </div>
        <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
          {device.host}
          {meta ? ` · ${meta}` : ''}
        </div>
        <div className="mt-0.5 text-[10px] text-muted-foreground">
          ports: HTTP {device.ports.http8080 ? '8080' : '—'} · TCP {device.ports.tcp8780 ? '8780' : '—'} · TLS{' '}
          {device.ports.tls28900 ? '28900' : '—'}
        </div>
        {device.machineInfo != null && typeof device.machineInfo === 'object' && (
          <details className="mt-1">
            <summary className="cursor-pointer text-[10px] text-muted-foreground">machineInfo</summary>
            <pre className="mt-1 max-h-28 overflow-auto rounded bg-muted p-1.5 font-mono text-[10px]">
              {JSON.stringify(device.machineInfo, null, 2)}
            </pre>
          </details>
        )}
        {device.family === 'v2' && (
          <p className="mt-1 text-[10px] text-amber-300/90">
            V2 uses TLS WebSocket on 28900. Open Laser Studio can record the address but cannot run jobs on it yet.
          </p>
        )}
      </div>
      <Button size="sm" variant={selected ? 'outline' : 'secondary'} onClick={() => onSelect(device)}>
        Select
      </Button>
    </div>
  );
}

function GateBanner() {
  const settings = useSettings((s) => s.settings);
  const setRightTab = useView((s) => s.setRightTab);
  const setOpen = useDevices((s) => s.setOpen);
  if (settings.developerMode && !settings.simulationOnly) return null;
  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-[11px] text-amber-100" data-testid="device-gate-banner">
      <p className="font-medium">Real-device scan is gated</p>
      <p className="mt-1 text-amber-100/80">
        Enable <strong>Developer mode</strong> and turn off <strong>Simulation only</strong> in Setup. Scanning sends a
        UDP broadcast on your LAN and read-only HTTP queries; nothing is written to the laser.
      </p>
      <Button
        size="sm"
        variant="outline"
        className="mt-2"
        onClick={() => {
          setOpen(false);
          setRightTab('setup');
        }}
      >
        Close and open Setup
      </Button>
    </div>
  );
}

export function DeviceFinderDialog() {
  const open = useDevices((s) => s.open);
  const setOpen = useDevices((s) => s.setOpen);
  const tab = useDevices((s) => s.tab);
  const setTab = useDevices((s) => s.setTab);
  const scanning = useDevices((s) => s.scanning);
  const results = useDevices((s) => s.results);
  const error = useDevices((s) => s.error);
  const manualHost = useDevices((s) => s.manualHost);
  const setManualHost = useDevices((s) => s.setManualHost);
  const scan = useDevices((s) => s.scan);
  const identify = useDevices((s) => s.identify);
  const select = useDevices((s) => s.select);
  const settings = useSettings((s) => s.settings);
  const host = useProject((s) => s.project?.machine.host ?? '');
  const gated = settings.developerMode && !settings.simulationOnly;

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="Find device"
      description="Search for an xTool laser over Wi-Fi or USB. Selecting a device saves its IP into the project machine profile. Jobs still run on the simulator."
      className="w-[520px]"
      modalLocked={scanning}
      footer={
        <Button variant="outline" onClick={() => setOpen(false)} disabled={scanning}>
          Close
        </Button>
      }
    >
      <div className="space-y-3" data-testid="device-finder">
        <GateBanner />
        {host && (
          <div className="text-[11px] text-muted-foreground">
            Current target: <span className="font-mono text-foreground">{connectionLabel(host)}</span>
            <span className="font-mono"> ({host})</span>
          </div>
        )}
        {error && (
          <div className="rounded border border-red-500/40 bg-red-500/10 p-2 text-[11px] text-red-200" data-testid="device-finder-error">
            {error}
          </div>
        )}

        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="wifi">
              <Wifi /> Wi-Fi
            </TabsTrigger>
            <TabsTrigger value="usb">
              <Usb /> USB
            </TabsTrigger>
            <TabsTrigger value="manual">
              <Radar /> Manual IP
            </TabsTrigger>
          </TabsList>

          <TabsContent value="wifi" className="space-y-2 pt-3">
            <p className="text-[10.5px] text-muted-foreground">
              PC and laser must be on the same LAN. The F1 supports 2.4 GHz Wi-Fi only. Disable HTTP/HTTPS proxies
              while scanning.
            </p>
            <Button size="sm" disabled={!gated || scanning} onClick={() => void scan('wifi')} data-testid="scan-wifi">
              {scanning && tab === 'wifi' ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              {scanning && tab === 'wifi' ? 'Scanning…' : 'Scan network'}
            </Button>
            <div className="max-h-64 space-y-1.5 overflow-auto">
              {results.wifi.map((d) => (
                <DeviceRow key={d.host} device={d} activeHost={host} onSelect={select} />
              ))}
              {!scanning && results.wifi.length === 0 && (
                <p className="text-[11px] text-muted-foreground">No devices yet. Click Scan network.</p>
              )}
            </div>
          </TabsContent>

          <TabsContent value="usb" className="space-y-2 pt-3">
            <p className="text-[10.5px] text-muted-foreground">
              Connect the laser with a USB cable. The device presents as a USB-Ethernet gadget at{' '}
              <span className="font-mono">201.234.3.1</span> (Linux) or <span className="font-mono">201.234.4.1</span>{' '}
              (macOS).
            </p>
            <Button size="sm" disabled={!gated || scanning} onClick={() => void scan('usb')} data-testid="scan-usb">
              {scanning && tab === 'usb' ? <Loader2 className="animate-spin" /> : <Usb />}
              {scanning && tab === 'usb' ? 'Detecting…' : 'Detect via USB'}
            </Button>
            <div className="max-h-64 space-y-1.5 overflow-auto">
              {results.usb.map((d) => (
                <DeviceRow key={d.host} device={d} activeHost={host} onSelect={select} />
              ))}
              {!scanning && results.usb.length === 0 && (
                <p className="text-[11px] text-muted-foreground">No USB gadget detected yet.</p>
              )}
            </div>
          </TabsContent>

          <TabsContent value="manual" className="space-y-2 pt-3">
            <p className="text-[10.5px] text-muted-foreground">
              Enter the laser&apos;s IPv4 address if you already know it (from xTool Studio or the router).
            </p>
            <div className="flex gap-1.5">
              <Input
                value={manualHost}
                placeholder="192.168.1.42"
                aria-label="Device IP"
                data-testid="manual-host"
                onChange={(e) => setManualHost(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void identify(manualHost);
                }}
              />
              <Button size="sm" disabled={!gated || scanning || !manualHost.trim()} onClick={() => void identify(manualHost)} data-testid="identify-manual">
                {scanning && tab === 'manual' ? <Loader2 className="animate-spin" /> : <Radar />}
                Identify
              </Button>
            </div>
            <div className="max-h-64 space-y-1.5 overflow-auto">
              {results.manual.map((d) => (
                <DeviceRow key={d.host} device={d} activeHost={host} onSelect={select} />
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </Dialog>
  );
}
