import { PIPELINE_STAGE_DEFS } from '../../utils/constants';
import type { RuntimeEvent } from '../../types/events';

interface PipelineProgressProps {
  events: RuntimeEvent[];
}

function computeStage(events: Array<{ event: string }>) {
  let reached = -1;
  for (const evt of events) {
    for (let i = 0; i < PIPELINE_STAGE_DEFS.length; i++) {
      if (PIPELINE_STAGE_DEFS[i].events.has(evt.event) && i > reached) {
        reached = i;
      }
    }
  }
  return reached;
}

export function PipelineProgress({ events }: PipelineProgressProps) {
  const stageIndex = computeStage(events);

  return (
    <div>
      <h3 className="text-sm font-medium mb-2">Pipeline Progress</h3>
      <div className="flex gap-1">
        {PIPELINE_STAGE_DEFS.map((stage, i) => (
          <div key={stage.id} className="flex-1">
            <div
              className={`h-2 rounded transition-colors duration-300 ${
                i <= stageIndex ? 'bg-accent' : 'bg-gray-200 dark:bg-gray-700'
              }`}
            />
            <p className="text-[10px] text-center mt-1 text-gray-500">{stage.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
