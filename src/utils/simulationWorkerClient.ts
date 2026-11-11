import {
  Draw,
  GeneratedColumn,
  SimulationMethodology,
  HundredDrawsSimulationResult
} from '../types/lottery';
import { runNext100DrawsSimulation } from './monteCarloSimulation';
import type { SimulationWorkerRequest, SimulationWorkerResponse } from './simulation.worker';

export interface RunSimulationParams {
  historicalDraws: Draw[];
  weeklyColumns: GeneratedColumn[];
  methodology: SimulationMethodology;
  seed: number;
  numDrawsToSimulate: number;
  coverageTarget: 'ambi' | 'terni';
}

let activeWorker: Worker | null = null;
let currentRequestId = 0;

/**
 * Esegue la simulazione Monte Carlo in un Web Worker dedicato per evitare il blocco del main thread UI
 * anche con 100.000 - 250.000 estrazioni. Se Web Worker non è disponibile (es. ambiente test Node.js),
 * effettua il fallback automatico sincrono.
 */
export function runSimulationInWorker(
  params: RunSimulationParams,
  onProgress?: (completedDraws: number, totalDraws: number) => void
): Promise<HundredDrawsSimulationResult> {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') {
    return Promise.resolve(
      runNext100DrawsSimulation(
        params.historicalDraws,
        params.weeklyColumns,
        params.methodology,
        params.seed,
        params.numDrawsToSimulate,
        params.coverageTarget,
        onProgress
      )
    );
  }

  return new Promise<HundredDrawsSimulationResult>((resolve, reject) => {
    try {
      if (activeWorker) {
        activeWorker.terminate();
        activeWorker = null;
      }

      const worker = new Worker(new URL('./simulation.worker.ts', import.meta.url), {
        type: 'module',
      });
      activeWorker = worker;
      const requestId = ++currentRequestId;

      worker.onmessage = (event: MessageEvent<SimulationWorkerResponse>) => {
        const msg = event.data;
        if (!msg || msg.requestId !== requestId) return;

        if (msg.type === 'PROGRESS') {
          onProgress?.(msg.completedDraws, msg.totalDraws);
        } else if (msg.type === 'RESULT') {
          worker.terminate();
          if (activeWorker === worker) activeWorker = null;
          resolve(msg.result);
        } else if (msg.type === 'ERROR') {
          worker.terminate();
          if (activeWorker === worker) activeWorker = null;
          try {
            const fallbackResult = runNext100DrawsSimulation(
              params.historicalDraws,
              params.weeklyColumns,
              params.methodology,
              params.seed,
              params.numDrawsToSimulate,
              params.coverageTarget,
              onProgress
            );
            resolve(fallbackResult);
          } catch (fallbackErr) {
            reject(fallbackErr);
          }
        }
      };

      worker.onerror = () => {
        worker.terminate();
        if (activeWorker === worker) activeWorker = null;
        try {
          const fallbackResult = runNext100DrawsSimulation(
            params.historicalDraws,
            params.weeklyColumns,
            params.methodology,
            params.seed,
            params.numDrawsToSimulate,
            params.coverageTarget,
            onProgress
          );
          resolve(fallbackResult);
        } catch (fallbackErr) {
          reject(fallbackErr);
        }
      };

      const request: SimulationWorkerRequest = {
        type: 'RUN_SIMULATION',
        requestId,
        ...params,
      };
      worker.postMessage(request);
    } catch {
      try {
        const fallbackResult = runNext100DrawsSimulation(
          params.historicalDraws,
          params.weeklyColumns,
          params.methodology,
          params.seed,
          params.numDrawsToSimulate,
          params.coverageTarget,
          onProgress
        );
        resolve(fallbackResult);
      } catch (err) {
        reject(err);
      }
    }
  });
}
