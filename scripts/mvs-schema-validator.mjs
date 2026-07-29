import mvsDataModule from 'molstar/lib/commonjs/extensions/mvs/mvs-data.js';

const { MVSData } = mvsDataModule;

export function validateOfficialMvs(story) {
  const issues = MVSData.validationIssues(story, { noExtra: false });
  return Array.isArray(issues) ? issues : [];
}
