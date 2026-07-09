import type { EmailFolder, EmailMessage } from '../../appTypes';
import type { ServiceJob } from '../../types';

type EmailModelInput = {
  emailMessages: EmailMessage[];
  emailFolder: EmailFolder;
  emailSearch: string;
  jobs: ServiceJob[];
};

export function makeEmailModel({
  emailMessages,
  emailFolder,
  emailSearch,
  jobs,
}: EmailModelInput) {
  const jobMap = new globalThis.Map(jobs.map((job) => [job.jobNumber, job]));
  const visibleEmailMessages = emailMessages.filter((message) => {
    const normalizedSearch = emailSearch.trim().toLowerCase();
    const job = jobMap.get(message.jobNumber);
    const haystack = [message.from, message.to, message.subject, message.preview, message.jobNumber, job?.organization, job?.clientName]
      .join(' ')
      .toLowerCase();

    return message.folder === emailFolder && (!normalizedSearch || haystack.includes(normalizedSearch));
  });

  return {
    jobMap,
    visibleEmailMessages,
  };
}
