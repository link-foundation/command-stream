// Lightweight ProcessRunner entry point without terminal capture dependencies

import { ProcessRunner } from './$.process-runner-base.mjs';
import { attachExecutionMethods } from './$.process-runner-execution.mjs';
import { attachOrchestrationMethods } from './$.process-runner-orchestration.mjs';
import { attachPipelineMethods } from './$.process-runner-pipeline.mjs';
import { attachStreamKillMethods } from './$.process-runner-stream-kill.mjs';
import { attachVirtualCommandMethods } from './$.process-runner-virtual.mjs';
import {
  globalShellSettings,
  isVirtualCommandsEnabled,
  virtualCommands,
} from './$.state.mjs';
import { trace } from './$.trace.mjs';

const dependencies = {
  virtualCommands,
  globalShellSettings,
  isVirtualCommandsEnabled,
};

attachExecutionMethods(ProcessRunner, dependencies);
attachPipelineMethods(ProcessRunner, dependencies);
attachOrchestrationMethods(ProcessRunner, dependencies);
attachVirtualCommandMethods(ProcessRunner, dependencies);
attachStreamKillMethods(ProcessRunner, dependencies);

trace(
  'Initialization',
  () => 'ProcessRunner methods attached via mixin pattern'
);

export { ProcessRunner };
