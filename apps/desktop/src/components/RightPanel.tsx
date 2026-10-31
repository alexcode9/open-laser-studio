import { Tabs, TabsContent, TabsList, TabsTrigger } from '@ols/ui';
import { Cpu, PenTool, Settings2 } from 'lucide-react';

import { LayersPanel } from '@/panels/LayersPanel';
import { MachinePanel } from '@/panels/MachinePanel';
import { PropertiesPanel } from '@/panels/PropertiesPanel';
import { SetupPanel } from '@/panels/SetupPanel';
import { useView } from '@/stores/view';

export function RightPanel() {
  const rightTab = useView((s) => s.rightTab);
  const setRightTab = useView((s) => s.setRightTab);
  return (
    <Tabs value={rightTab} onValueChange={(v) => setRightTab(v as typeof rightTab)} className="flex h-full flex-col bg-card">
      <TabsList>
        <TabsTrigger value="design">
          <PenTool /> Design
        </TabsTrigger>
        <TabsTrigger value="machine" data-testid="tab-machine">
          <Cpu /> Machine
        </TabsTrigger>
        <TabsTrigger value="setup" data-testid="tab-setup">
          <Settings2 /> Setup
        </TabsTrigger>
      </TabsList>
      <TabsContent value="design">
        <PropertiesPanel />
        <LayersPanel />
      </TabsContent>
      <TabsContent value="machine" forceMount>
        <MachinePanel />
      </TabsContent>
      <TabsContent value="setup">
        <SetupPanel />
      </TabsContent>
    </Tabs>
  );
}
