/** Only http(s) links are rendered: anything else from the web (javascript:, data:) is dropped. */
export const safeUrl = (url: string) => (/^https?:\/\//i.test(url) ? url : null);
