export const SIMULATION_MINUTES_PER_REAL_SECOND = 1.8;

export const advanceSimulationTime = (currentMinutes: number, elapsedSeconds: number): number => (
  currentMinutes + Math.max(0, elapsedSeconds) * SIMULATION_MINUTES_PER_REAL_SECOND
);

export const simulationTimeToWorldMilliseconds = (simulationMinutes: number): number => (
  Math.max(0, simulationMinutes) / SIMULATION_MINUTES_PER_REAL_SECOND * 1000
);
