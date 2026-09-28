export function buildCommitDate(date, sequence) {
  const commitDate = new Date(`${date}T09:00:00Z`);
  commitDate.setUTCMinutes(commitDate.getUTCMinutes() + (sequence - 1) * 7);
  return commitDate.toISOString().replace('.000Z', 'Z');
}
