export async function request(path, method = 'GET', data) {
  const file = typeof File !== 'undefined' && data instanceof File;
  const headers = method === 'GET' ? {} : { 'x-knowledge-ui': '1' };
  if (data !== undefined && !file) headers['content-type'] = 'application/json';
  const response = await fetch('/knowledge' + path, {
    method,
    headers,
    body: file ? data : data === undefined ? undefined : JSON.stringify(data),
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error('Harness could not reach Knowledge.');
  }
  if (!response.ok) throw new Error(result.error || 'Request failed');
  return result;
}
