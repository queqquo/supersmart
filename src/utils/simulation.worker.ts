/// <reference lib="webworker" />
import {
  Draw,
  GeneratedColumn,
  SimulationMethodology,
  HundredDrawsSimulationResult
} from '../types/lottery';
import { runNext100DrawsSimulation } from './monteCarloSimulation';

export interface SimulationWorkerRequest {
  type: 'RUN_SIMULATION';
  requestId: number;
  historicalDraws: Draw[];
  weeklyColumns: GeneratedColumn[];
  methodology: SimulationMethodology;
  seed: number;
  numDrawsToSimulate: number;
  coverageTarget: 'ambi' | 'terni';
}

export interface SimulationWorkerProgressMessage {
  type: 'PROGRESS';
  requestId: number;
  completedDraws: number;
  totalDraws: number;
}

export interface SimulationWorkerResultMessage {
  type: 'RESULT';
  requestId: number;
  result: HundredDrawsSimulationResult;
}

export interface SimulationWorkerErrorMessage {
  type: 'ERROR';
  requestId: number;
  error: string;
}

export type SimulationWorkerResponse =
  | SimulationWorkerProgressMessage
  | SimulationWorkerResultMessage
  | SimulationWorkerErrorMessage;

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (event: MessageEvent<SimulationWorkerRequest>) => {
  const data = event.data;
  if (!data || data.type !== 'RUN_SIMULATION') return;

  try {
    const result = runNext100DrawsSimulation(
      data.historicalDraws,
      data.weeklyColumns,
      data.methodology,
      data.seed,
      data.numDrawsToSimulate,
      data.coverageTarget,
      (completedDraws, totalDraws) => {
        const progressMsg: SimulationWorkerProgressMessage = {
          type: 'PROGRESS',
          requestId: data.requestId,
          completedDraws,
          totalDraws,
        };
        ctx.postMessage(progressMsg);
      }
    );

    const resultMsg: SimulationWorkerResultMessage = {
      type: 'RESULT',
      requestId: data.requestId,
      result,
    };
    ctx.postMessage(resultMsg);
  } catch (err) {
    const errorMsg: SimulationWorkerErrorMessage = {
      type: 'ERROR',
      requestId: data.requestId,
      error: err instanceof Error ? err.message : String(err),
    };
    ctx.postMessage(errorMsg);
  }
};
