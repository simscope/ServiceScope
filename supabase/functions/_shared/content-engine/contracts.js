export const channels = ['Instagram', 'Facebook', 'LinkedIn', 'Google Business', 'Blog / Case Study', 'Short Video'];
export const tones = ['Professional', 'Friendly', 'Technical', 'Educational', 'Marketing'];
export const mediaLabels = ['Overview', 'Problem', 'Repair', 'Part', 'Result'];
export const promptVersionByChannel = {
  Instagram: 'instagram-v1',
  Facebook: 'facebook-v1',
  LinkedIn: 'linkedin-v1',
  'Google Business': 'google-business-v1',
  'Blog / Case Study': 'blog-case-study-v1',
  'Short Video': 'short-video-v1',
};

export const resultSchemaVersion = 'content-generation-result-v1';
export const requestSchemaVersion = 'content-generation-request-v1';
export const maxRequestBytes = 18_000;
export const maxLocalFactLength = 700;
export const maxMediaItems = 24;
export const maxOutputBytes = 16_000;
export const idempotencyKeyPattern = /^[A-Za-z0-9:_-]{8,160}$/;
