export function asNodeHandler(createHandler) {
  return async function nodeHandler(request, response) {
    const webResponse = await createHandler()(await toWebRequest(request));
    response.statusCode = webResponse.status;
    for (const [name, value] of webResponse.headers) response.setHeader(name, value);
    response.end(Buffer.from(await webResponse.arrayBuffer()));
  };
}

async function toWebRequest(request) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers ?? {})) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
    else if (value !== undefined) headers.set(name, String(value));
  }
  const method = String(request.method ?? 'GET').toUpperCase();
  const body = method === 'GET' || method === 'HEAD' ? undefined : await requestBody(request);
  const host = headers.get('host') ?? 'localhost';
  return new Request(`https://${host}${request.url ?? '/'}`, { method, headers, body });
}

async function requestBody(request) {
  if (request.body !== undefined) {
    if (typeof request.body === 'string' || request.body instanceof Uint8Array || Buffer.isBuffer(request.body)) return request.body;
    return JSON.stringify(request.body);
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
