import type { PublicationStatus } from "@reviewflow/domain";

export interface PublishJobRecord {
  id: string;
  manifestId: string;
  status: PublicationStatus;
  dryRun: boolean;
  createdAt: string;
  updatedAt: string;
  details?: Record<string, unknown>;
}

export const upsertPublishJob = (
  records: PublishJobRecord[],
  job: PublishJobRecord,
): PublishJobRecord[] => [job, ...records.filter((record) => record.id !== job.id)];

export const refreshPublishJobs = async (
  records: PublishJobRecord[],
  load: (id: string) => Promise<PublishJobRecord>,
): Promise<PublishJobRecord[]> => Promise.all(records.map(async (record) => {
  try {
    const refreshed = await load(record.id);
    return refreshed.id === record.id ? refreshed : record;
  } catch {
    return record;
  }
}));
