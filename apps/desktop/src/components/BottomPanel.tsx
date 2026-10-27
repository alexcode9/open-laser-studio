import { Tabs, TabsContent, TabsList, TabsTrigger } from '@ols/ui';
import { Activity, ClipboardList, FileCode2, ListTree, ScrollText } from 'lucide-react';

import { GcodePanel } from '@/bottom/GcodePanel';
import { JobLogPanel, PlanReportPanel, ProtocolLogPanel } from '@/bottom/LogPanels';
import { TimelinePanel } from '@/bottom/TimelinePanel';

export function BottomPanel() {
  return (
    <Tabs defaultValue="timeline" className="flex h-full flex-col bg-card">
      <TabsList>
        <TabsTrigger value="timeline">
          <Activity /> Timeline
        </TabsTrigger>
        <TabsTrigger value="plan" data-testid="tab-plan">
          <ListTree /> Plan
        </TabsTrigger>
        <TabsTrigger value="gcode" data-testid="tab-gcode">
          <FileCode2 /> G-code
        </TabsTrigger>
        <TabsTrigger value="protocol">
          <ScrollText /> Protocol log
        </TabsTrigger>
        <TabsTrigger value="job">
          <ClipboardList /> Job &amp; safety log
        </TabsTrigger>
      </TabsList>
      <TabsContent value="timeline" className="overflow-hidden">
        <TimelinePanel />
      </TabsContent>
      <TabsContent value="plan" className="overflow-hidden">
        <PlanReportPanel />
      </TabsContent>
      <TabsContent value="gcode" className="overflow-hidden">
        <GcodePanel />
      </TabsContent>
      <TabsContent value="protocol" className="overflow-hidden">
        <ProtocolLogPanel />
      </TabsContent>
      <TabsContent value="job" className="overflow-hidden">
        <JobLogPanel />
      </TabsContent>
    </Tabs>
  );
}
