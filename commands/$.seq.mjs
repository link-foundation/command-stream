import { VirtualUtils } from '../$.utils.mjs';

export default async function seq({ args }) {
  const argError = VirtualUtils.validateArgs(args, 1, 'seq');
  if (argError) return argError;

  let start, step, end;
  
  if (args.length === 1) {
    // seq END
    start = 1;
    step = 1;
    end = parseFloat(args[0]);
  } else if (args.length === 2) {
    // seq START END
    start = parseFloat(args[0]);
    step = 1;
    end = parseFloat(args[1]);
  } else {
    // seq START STEP END
    start = parseFloat(args[0]);
    step = parseFloat(args[1]);
    end = parseFloat(args[2]);
  }
  
  // Validate numbers
  if (isNaN(start) || isNaN(step) || isNaN(end)) {
    return VirtualUtils.error('seq: invalid number');
  }
  
  if (step === 0) {
    return VirtualUtils.error('seq: step cannot be zero');
  }
  
  const output = [];
  
  if (step > 0) {
    for (let i = start; i <= end; i += step) {
      output.push(i.toString());
    }
  } else {
    for (let i = start; i >= end; i += step) {
      output.push(i.toString());
    }
  }
  
  return VirtualUtils.success(output.join('\n') + (output.length > 0 ? '\n' : ''));
}