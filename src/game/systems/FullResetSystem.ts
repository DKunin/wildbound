export interface FullResetActions {
  clearSave: () => Promise<void>;
  startFresh: () => void;
  reportFailure: (error: unknown) => void;
}

export const runFullReset = async ({ clearSave, startFresh, reportFailure }: FullResetActions): Promise<boolean> => {
  try {
    await clearSave();
    startFresh();
    return true;
  } catch (error) {
    reportFailure(error);
    return false;
  }
};
