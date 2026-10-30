/** Export reads must not advance the editor revision or overwrite another window. */
export async function prepareSavedScreenExport<T>(options: {
  writable: boolean;
  dirty: boolean;
  unchanged: boolean;
  persist: () => Promise<T>;
  readSaved: () => Promise<T>;
}): Promise<{ saved: T; readOnly: boolean }> {
  if (!options.writable || !options.dirty || options.unchanged) {
    return { saved: await options.readSaved(), readOnly: !options.writable };
  }
  try {
    return { saved: await options.persist(), readOnly: false };
  } catch (error) {
    if ((error as { status?: number }).status !== 423) throw error;
    return { saved: await options.readSaved(), readOnly: true };
  }
}
